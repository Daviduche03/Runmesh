package fuse

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
	rfs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/object"

	"runmesh/workspace/internal/config"
)

// FsNode is a FUSE directory that maps to a cloud prefix.
type FsNode struct {
	fs.Inode
	rc     *config.RemoteConfig
	prefix string // cloud prefix (e.g. "midday/")
}

var _ = (fs.NodeLookuper)((*FsNode)(nil))
var _ = (fs.NodeReaddirer)((*FsNode)(nil))
var _ = (fs.NodeMkdirer)((*FsNode)(nil))
var _ = (fs.NodeCreater)((*FsNode)(nil))
var _ = (fs.NodeUnlinker)((*FsNode)(nil))
var _ = (fs.NodeRmdirer)((*FsNode)(nil))
var _ = (fs.NodeGetattrer)((*FsNode)(nil))
var _ = (fs.NodeSetattrer)((*FsNode)(nil))

func (d *FsNode) newFs(ctx context.Context) (rfs.Fs, error) {
	return d.rc.NewFs(ctx, d.rc.DefaultBucket, d.prefix)
}

func (d *FsNode) Getattr(ctx context.Context, fh fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	out.Mode = syscall.S_IFDIR | 0755
	out.SetTimeout(10 * time.Second)
	return 0
}

func (d *FsNode) Setattr(ctx context.Context, fh fs.FileHandle, in *fuse.SetAttrIn, out *fuse.AttrOut) syscall.Errno {
	out.Mode = syscall.S_IFDIR | 0755
	out.SetTimeout(10 * time.Second)
	return 0
}

func (d *FsNode) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	cloudFs, err := d.newFs(ctx)
	if err != nil {
		return nil, syscall.EIO
	}

	// Check if it's a directory
	dirFs, err := d.rc.NewFs(ctx, d.rc.DefaultBucket, d.prefix+name)
	if err == nil {
		if _, err := dirFs.List(ctx, ""); err == nil {
			child := d.NewInode(ctx, &FsNode{
				rc:     d.rc,
				prefix: d.prefix + name + "/",
			}, fs.StableAttr{Mode: syscall.S_IFDIR})
			out.Mode = syscall.S_IFDIR | 0755
			out.SetEntryTimeout(10 * time.Second)
			return child, 0
		}
	}

	// Check if it's a file
	obj, err := cloudFs.NewObject(ctx, name)
	if err != nil {
		return nil, syscall.ENOENT
	}

	child := d.NewInode(ctx, &FileNode{
		rc:     d.rc,
		prefix: d.prefix + name,
		size:   uint64(obj.Size()),
	}, fs.StableAttr{Mode: syscall.S_IFREG})

	out.Mode = syscall.S_IFREG | 0644
	out.Size = uint64(obj.Size())
	out.SetEntryTimeout(5 * time.Second)
	return child, 0
}

func (d *FsNode) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	cloudFs, err := d.newFs(ctx)
	if err != nil {
		return nil, syscall.EIO
	}
	entries, err := cloudFs.List(ctx, "")
	if err != nil {
		return nil, syscall.EIO
	}
	var dirEntries []fuse.DirEntry
	for _, e := range entries {
		mode := uint32(syscall.S_IFREG | 0644)
		if _, ok := e.(rfs.Directory); ok {
			mode = syscall.S_IFDIR | 0755
		}
		dirEntries = append(dirEntries, fuse.DirEntry{
			Name: e.Remote(),
			Mode: mode,
		})
	}
	return fs.NewListDirStream(dirEntries), 0
}

func (d *FsNode) Mkdir(ctx context.Context, name string, mode uint32, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	dirFs, err := d.rc.NewFs(ctx, d.rc.DefaultBucket, d.prefix+name)
	if err != nil {
		return nil, syscall.EIO
	}
	if err := dirFs.Mkdir(ctx, ""); err != nil {
		return nil, syscall.EIO
	}
	child := d.NewInode(ctx, &FsNode{
		rc:     d.rc,
		prefix: d.prefix + name + "/",
	}, fs.StableAttr{Mode: syscall.S_IFDIR})
	out.Mode = syscall.S_IFDIR | 0755
	return child, 0
}

func (d *FsNode) Create(ctx context.Context, name string, flags uint32, mode uint32, out *fuse.EntryOut) (node *fs.Inode, fh fs.FileHandle, fuseFlags uint32, errno syscall.Errno) {
	fn := &FileNode{
		rc:     d.rc,
		prefix: d.prefix + name,
		size:   0,
	}
	child := d.NewInode(ctx, fn, fs.StableAttr{Mode: syscall.S_IFREG})
	out.Mode = syscall.S_IFREG | 0644
	out.Size = 0

	handle := &FileHandle{file: fn, buf: make([]byte, 0)}
	return child, handle, 0, 0
}

func (d *FsNode) Unlink(ctx context.Context, name string) syscall.Errno {
	cloudFs, err := d.newFs(ctx)
	if err != nil {
		return syscall.EIO
	}
	obj, err := cloudFs.NewObject(ctx, name)
	if err != nil {
		return syscall.ENOENT
	}
	if err := obj.Remove(ctx); err != nil {
		return syscall.EIO
	}
	return 0
}

func (d *FsNode) Rmdir(ctx context.Context, name string) syscall.Errno {
	dirFs, err := d.rc.NewFs(ctx, d.rc.DefaultBucket, d.prefix+name)
	if err != nil {
		return syscall.EIO
	}
	// List and remove all contents first
	entries, err := dirFs.List(ctx, "")
	if err != nil {
		return syscall.EIO
	}
	for _, e := range entries {
		if obj, ok := e.(rfs.Object); ok {
			obj.Remove(ctx)
		}
	}
	return syscall.ENOTSUP
}

// FileNode is a FUSE file that maps to a cloud object.
type FileNode struct {
	fs.Inode
	rc     *config.RemoteConfig
	prefix string // cloud path (relative to bucket, includes filename)
	size   uint64
}

type FileHandle struct {
	file *FileNode
	mu   sync.Mutex
	buf  []byte
}

var _ = (fs.NodeGetattrer)((*FileNode)(nil))
var _ = (fs.NodeOpener)((*FileNode)(nil))

func (f *FileNode) Getattr(ctx context.Context, fh fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	out.Size = f.size
	out.Mode = syscall.S_IFREG | 0644
	out.SetTimeout(5 * time.Second)
	return 0
}

func (f *FileNode) Open(ctx context.Context, flags uint32) (fh fs.FileHandle, fuseFlags uint32, errno syscall.Errno) {
	cloudFs, err := f.rc.NewFs(ctx, f.rc.DefaultBucket, f.prefix)
	if err != nil {
		return nil, 0, syscall.EIO
	}
	obj, err := cloudFs.NewObject(ctx, "")
	if err != nil {
		return nil, 0, syscall.ENOENT
	}
	reader, err := obj.Open(ctx)
	if err != nil {
		return nil, 0, syscall.EIO
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, 0, syscall.EIO
	}

	return &FileHandle{file: f, buf: data}, 0, 0
}

func (h *FileHandle) Read(ctx context.Context, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if off >= int64(len(h.buf)) {
		return fuse.ReadResultData(nil), 0
	}
	end := off + int64(len(dest))
	if end > int64(len(h.buf)) {
		end = int64(len(h.buf))
	}
	return fuse.ReadResultData(h.buf[off:end]), 0
}

func (h *FileHandle) Write(ctx context.Context, data []byte, off int64) (uint32, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()

	end := off + int64(len(data))
	if end > int64(len(h.buf)) {
		newBuf := make([]byte, end)
		copy(newBuf, h.buf)
		h.buf = newBuf
	}
	copy(h.buf[off:], data)
	h.file.size = uint64(len(h.buf))
	return uint32(len(data)), 0
}

func (h *FileHandle) Flush(ctx context.Context) syscall.Errno {
	h.mu.Lock()
	data := make([]byte, len(h.buf))
	copy(data, h.buf)
	h.mu.Unlock()

	// Split prefix into directory + filename
	prefix := h.file.prefix
	var dir, name string
	if idx := strings.LastIndex(prefix, "/"); idx >= 0 {
		dir = prefix[:idx] + "/"
		name = prefix[idx+1:]
	} else {
		dir = ""
		name = prefix
	}

	cloudFs, err := h.file.rc.NewFs(ctx, h.file.rc.DefaultBucket, dir)
	if err != nil {
		return syscall.EIO
	}

	src := object.NewStaticObjectInfo(name, time.Now(), int64(len(data)), true, nil, cloudFs)
	if _, err := cloudFs.Put(ctx, bytes.NewReader(data), src); err != nil {
		fmt.Fprintf(os.Stderr, "write error %s: %v\n", prefix, err)
		return syscall.EIO
	}
	return 0
}

// Mount creates and starts a FUSE filesystem.
func Mount(mountpoint string, rc *config.RemoteConfig, prefix string) (*fuse.Server, error) {
	root := &FsNode{
		rc:     rc,
		prefix: prefix + "/",
	}

	sec := 1 * time.Second
	opts := &fs.Options{
		EntryTimeout: &sec,
		AttrTimeout:  &sec,
		MountOptions: fuse.MountOptions{
			FsName: rc.DefaultBucket + "/" + prefix,
			Name:   "continuumm",
		},
	}

	server, err := fs.Mount(mountpoint, root, opts)
	if err != nil {
		return nil, fmt.Errorf("mounting: %w", err)
	}

	return server, nil
}
