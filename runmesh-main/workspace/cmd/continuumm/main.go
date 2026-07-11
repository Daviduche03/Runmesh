package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"runmesh/workspace/internal/config"
	"runmesh/workspace/internal/fuse"
	"runmesh/workspace/internal/sync"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	sync.Init()

	switch os.Args[1] {
	case "link":
		dir, err := os.Getwd()
		if err != nil {
			fatal("Error: %v", err)
		}
		cmdLink(dir)
	case "config":
		cmdConfig(os.Args[2:])
	case "list":
		projectDir, err := findProjectRoot()
		if err != nil {
			fatal("Error: %v", err)
		}
		cmdList(projectDir)
	case "status":
		projectDir, err := findProjectRoot()
		if err != nil {
			fatal("Error: %v", err)
		}
		cmdStatus(projectDir)
	case "up", "down":
		projectDir, err := findProjectRoot()
		if err != nil {
			fatal("Error: %v", err)
		}
		if os.Args[1] == "up" {
			cmdUp(projectDir)
		} else {
			cmdDown(projectDir)
		}
	case "watch":
		projectDir, err := findProjectRoot()
		if err != nil {
			fatal("Error: %v", err)
		}
		cmdWatch(projectDir)
	case "mount":
		cmdMount(os.Args[2:])
	case "umount":
		cmdUmount(os.Args[2:])
	default:
		usage()
		os.Exit(1)
	}
}

func fatal(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func usage() {
	fmt.Fprintf(os.Stderr, `Continuumm — Dev environment syncing

Usage:
  continuumm config set    Save cloud storage credentials globally
  continuumm link          Link this directory to a cloud prefix
  continuumm up            Push local changes to cloud
  continuumm down          Pull cloud changes to local
  continuumm list          List files on remote
  continuumm status        Show sync status
  continuumm watch         Auto-sync local changes to cloud
  continuumm mount <dir>   Mount cloud bucket as a FUSE filesystem
  continuumm umount <dir>  Unmount a FUSE filesystem
`)
}

func loadProject(projectDir string) (*config.RemoteConfig, *config.ProjectConfig) {
	global, err := config.LoadGlobal()
	if err != nil {
		fatal("Error loading credentials: %v", err)
	}
	proj, err := config.LoadProject(projectDir)
	if err != nil {
		fatal("Error loading project config: %v", err)
	}
	if global == nil || proj == nil {
		fatal("Run 'continuumm config set' and 'continuumm link <prefix>' first")
	}
	return global, proj
}

func cmdConfig(args []string) {
	if len(args) < 1 || args[0] != "set" {
		fatal("Usage: continuumm config set --bucket ... --endpoint ... --access-key ... --secret-key ...")
	}

	fs := flag.NewFlagSet("config set", flag.ExitOnError)
	provider := fs.String("provider", "Cloudflare", "S3-compatible provider")
	endpoint := fs.String("endpoint", "", "Storage endpoint URL")
	region := fs.String("region", "auto", "Region")
	accessKey := fs.String("access-key", "", "Access key ID")
	secretKey := fs.String("secret-key", "", "Secret access key")
	bucket := fs.String("bucket", "", "Default R2/S3 bucket name")
	fs.Parse(args[1:])

	if *endpoint == "" || *accessKey == "" || *secretKey == "" || *bucket == "" {
		fatal("--bucket, --endpoint, --access-key, and --secret-key are required")
	}

	cfg := &config.RemoteConfig{
		Provider:      *provider,
		Endpoint:      *endpoint,
		Region:        *region,
		AccessKey:     *accessKey,
		SecretKey:     *secretKey,
		DefaultBucket: *bucket,
	}
	if err := config.SaveGlobal(cfg); err != nil {
		fatal("Error saving credentials: %v", err)
	}
	fmt.Fprintf(os.Stderr, "Credentials saved to ~/.continuumm/config.json\n")
}

func findProjectRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, ".continuumm")); err == nil {
			return dir, nil
		}
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no project root found (no .continuumm or .git directory)")
		}
		dir = parent
	}
}

func cmdLink(projectDir string) {
	global, err := config.LoadGlobal()
	if err != nil {
		fatal("Error loading credentials: %v", err)
	}
	if global == nil {
		fatal("No credentials found. Run 'continuumm config set' first.")
	}

	proj, err := config.LoadProject(projectDir)
	if err != nil {
		fatal("Error loading project config: %v", err)
	}
	if proj != nil {
		fatal("Already linked as '%s' in %s", proj.Prefix, projectDir)
	}

	if len(os.Args) < 3 || os.Args[2] == "" {
		fatal("Usage: continuumm link <prefix>")
	}

	proj = &config.ProjectConfig{Prefix: os.Args[2]}
	if err := config.SaveProject(projectDir, proj); err != nil {
		fatal("Error saving project config: %v", err)
	}

	ignorePath := filepath.Join(projectDir, ".devignore")
	if _, err := os.Stat(ignorePath); os.IsNotExist(err) {
		defaultIgnore := `# .devignore — files and directories to exclude from sync
.git/
node_modules/
build/
dist/
target/
.cache/
__pycache__/
*.pyc
.next/
.venv/
.env
vendor/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db
`
		if err := os.WriteFile(ignorePath, []byte(defaultIgnore), 0644); err != nil {
			fatal("Error writing .devignore: %v", err)
		}
	}

	fmt.Fprintf(os.Stderr, "Linked %s → cloud: %s/%s\n", projectDir, global.DefaultBucket, proj.Prefix)
}

func cmdUp(projectDir string) {
	global, proj := loadProject(projectDir)
	if err := sync.Up(projectDir, global, proj); err != nil {
		fatal("Sync up failed: %v", err)
	}
}

func cmdDown(projectDir string) {
	global, proj := loadProject(projectDir)
	if err := sync.Down(projectDir, global, proj); err != nil {
		fatal("Sync down failed: %v", err)
	}
}

func cmdList(projectDir string) {
	global, proj := loadProject(projectDir)
	if err := sync.List(projectDir, global, proj); err != nil {
		fatal("List failed: %v", err)
	}
}

func cmdStatus(projectDir string) {
	global, proj := loadProject(projectDir)
	if err := sync.Status(projectDir, global, proj); err != nil {
		fatal("Status failed: %v", err)
	}
}

func cmdWatch(projectDir string) {
	global, proj := loadProject(projectDir)
	if err := sync.Watch(projectDir, global, proj); err != nil {
		fatal("Watch failed: %v", err)
	}
}

func cmdMount(args []string) {
	if len(args) < 1 {
		fatal("Usage: continuumm mount <mountpoint> [--prefix <prefix>]")
	}
	mountpoint := args[0]

	prefix := ""
	for i := 1; i < len(args); i++ {
		if args[i] == "--prefix" && i+1 < len(args) {
			prefix = args[i+1]
		}
	}

	if prefix == "" {
		// Try to get from project config
		dir := filepath.Dir(mountpoint)
		proj, err := config.LoadProject(dir)
		if err == nil && proj != nil {
			prefix = proj.Prefix
		}
	}
	if prefix == "" {
		fatal("No prefix specified. Use --prefix <prefix> or run from a linked project.")
	}

	rc, err := config.LoadGlobal()
	if err != nil || rc == nil {
		fatal("No credentials found. Run 'continuumm config set' first.")
	}

	server, err := fuse.Mount(mountpoint, rc, prefix)
	if err != nil {
		fatal("Mount failed: %v", err)
	}
	fmt.Fprintf(os.Stderr, "Mounted %s/%s at %s\n", rc.DefaultBucket, prefix, mountpoint)
	fmt.Fprintf(os.Stderr, "Press Ctrl+C to unmount.\n")
	server.Wait()
}

func cmdUmount(args []string) {
	if len(args) < 1 {
		fatal("Usage: continuumm umount <mountpoint>")
	}
	cmd := exec.Command("umount", args[0])
	cmd.Stderr = os.Stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		fatal("Unmount failed: %v", err)
	}
	fmt.Fprintf(os.Stderr, "Unmounted %s\n", args[0])
}
