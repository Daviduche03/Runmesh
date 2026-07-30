package sync

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/operations"
	"github.com/rclone/rclone/fs/walk"
	gitignore "github.com/sabhiram/go-gitignore"

	"runmesh/workspace/internal/envcrypt"
)

// localEnvFiles walks the project and returns slash-separated relative paths
// of syncable env files. Directory-level ignores (.git, .runmesh, node_modules,
// …) are honored; a file-level .env ignore in .devignore is intentionally
// overridden — env files only ever travel via this encrypted channel.
func localEnvFiles(projectDir string, matcher *gitignore.GitIgnore) ([]string, error) {
	var out []string
	err := filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(projectDir, path)
		if err != nil || rel == "." {
			return nil
		}
		if info.IsDir() {
			base := info.Name()
			if base == ".git" || base == ".runmesh" {
				return filepath.SkipDir
			}
			if matcher != nil && (matcher.MatchesPath(rel) || matcher.MatchesPath(rel+"/")) {
				return filepath.SkipDir
			}
			return nil
		}
		if envcrypt.IsEnvFile(filepath.ToSlash(rel)) {
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	return out, err
}

// remoteEnvFiles maps remote ".enc" object names to their objects.
func remoteEnvFiles(ctx context.Context, rfs fs.Fs) (map[string]fs.Object, error) {
	out := map[string]fs.Object{}
	err := walk.Walk(ctx, rfs, "", false, -1, func(path string, entries fs.DirEntries, err error) error {
		if err != nil {
			return err
		}
		for _, entry := range entries {
			obj, ok := entry.(fs.Object)
			if !ok {
				continue
			}
			if envcrypt.IsEncryptedEnvFile(obj.Remote()) {
				out[obj.Remote()] = obj
			}
		}
		return nil
	})
	return out, err
}

func readObject(ctx context.Context, obj fs.Object) ([]byte, error) {
	rc, err := obj.Open(ctx)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// PushEnv encrypts local env files and uploads them as "<name>.enc" siblings.
// Remote ".enc" blobs whose local file was deleted are removed. Without a key,
// env files are skipped with a warning — plaintext is never uploaded.
func PushEnv(ctx context.Context, projectDir string, rfs fs.Fs, key []byte, matcher *gitignore.GitIgnore) error {
	locals, err := localEnvFiles(projectDir, matcher)
	if err != nil {
		return fmt.Errorf("scanning env files: %w", err)
	}
	if len(key) == 0 {
		if len(locals) > 0 {
			fmt.Fprintf(os.Stderr, "Skipped %d env file(s) (no encryption key). Enable encrypted sync: runmesh envkey --generate\n", len(locals))
		}
		return nil
	}
	remotes, err := remoteEnvFiles(ctx, rfs)
	if err != nil {
		return fmt.Errorf("listing remote env files: %w", err)
	}

	pushed, current, deleted := 0, 0, 0
	seen := map[string]bool{}
	for _, rel := range locals {
		data, err := os.ReadFile(filepath.Join(projectDir, filepath.FromSlash(rel)))
		if err != nil {
			return fmt.Errorf("reading %s: %w", rel, err)
		}
		remoteName := envcrypt.EncryptedName(rel)
		seen[remoteName] = true
		if obj, ok := remotes[remoteName]; ok {
			if blob, err := readObject(ctx, obj); err == nil {
				if tag, err := envcrypt.ReadTag(blob); err == nil && envcrypt.TagEquals(key, data, tag) {
					current++
					continue
				}
			}
		}
		blob, err := envcrypt.Encrypt(key, data)
		if err != nil {
			return fmt.Errorf("encrypting %s: %w", rel, err)
		}
		if _, err := operations.Rcat(ctx, rfs, remoteName, io.NopCloser(bytes.NewReader(blob)), time.Now(), nil); err != nil {
			return fmt.Errorf("uploading %s: %w", remoteName, err)
		}
		pushed++
	}
	for name, obj := range remotes {
		if !seen[name] {
			if err := obj.Remove(ctx); err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to delete remote %s: %v\n", name, err)
				continue
			}
			deleted++
		}
	}
	if pushed+deleted > 0 {
		fmt.Fprintf(os.Stderr, "Env: %d encrypted → cloud, %d deleted, %d unchanged\n", pushed, deleted, current)
	}
	return nil
}

// PullEnv downloads and decrypts remote ".enc" blobs into local env files.
// It never deletes local env files — a missing remote blob is not proof the
// file should disappear (e.g. fresh device that has not pushed yet).
func PullEnv(ctx context.Context, projectDir string, rfs fs.Fs, key []byte) error {
	remotes, err := remoteEnvFiles(ctx, rfs)
	if err != nil {
		return fmt.Errorf("listing remote env files: %w", err)
	}
	if len(key) == 0 {
		if len(remotes) > 0 {
			fmt.Fprintf(os.Stderr, "Cloud holds %d encrypted env file(s) but no key is configured. Set it with: runmesh config set --env-key <hex>\n", len(remotes))
		}
		return nil
	}
	pulled, current := 0, 0
	for name, obj := range remotes {
		rel := envcrypt.DecryptedName(name)
		localPath := filepath.Join(projectDir, filepath.FromSlash(rel))
		// Guard against path traversal from a hostile/malformed remote name
		if !strings.HasPrefix(localPath, filepath.Clean(projectDir)+string(os.PathSeparator)) {
			fmt.Fprintf(os.Stderr, "warning: skipping suspicious remote path %s\n", name)
			continue
		}
		blob, err := readObject(ctx, obj)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: downloading %s: %v\n", name, err)
			continue
		}
		if data, err := os.ReadFile(localPath); err == nil {
			if tag, err := envcrypt.ReadTag(blob); err == nil && envcrypt.TagEquals(key, data, tag) {
				current++
				continue
			}
		}
		plain, err := envcrypt.Decrypt(key, blob)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: cannot decrypt %s: %v\n", name, err)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
			return fmt.Errorf("creating dir for %s: %w", rel, err)
		}
		tmp := localPath + ".runmesh-tmp"
		if err := os.WriteFile(tmp, plain, 0600); err != nil {
			return fmt.Errorf("writing %s: %w", rel, err)
		}
		if err := os.Rename(tmp, localPath); err != nil {
			os.Remove(tmp)
			return fmt.Errorf("installing %s: %w", rel, err)
		}
		pulled++
	}
	if pulled > 0 {
		fmt.Fprintf(os.Stderr, "Env: %d decrypted → local, %d unchanged\n", pulled, current)
	}
	return nil
}
