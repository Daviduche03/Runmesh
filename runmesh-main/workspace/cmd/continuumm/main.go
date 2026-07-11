package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

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
	case "login":
		cmdLogin()
	case "whoami":
		cmdWhoami()
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
  continuumm login         Authenticate CLI with Runmesh
  continuumm whoami        Show current authenticated user
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
	apiBase := fs.String("api-base", "", "Runmesh API base URL")
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
		APIBase:       *apiBase,
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

const defaultAPIBase = "https://runmesh.daviduche176.workers.dev"

type cliStartResponse struct {
	Ok   bool `json:"ok"`
	Data *struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		ExpiresIn       int    `json:"expires_in"`
	} `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type cliPollResponse struct {
	Ok   bool `json:"ok"`
	Data *struct {
		Status string `json:"status"`
		Token  string `json:"token,omitempty"`
		User   *struct {
			ID    string `json:"id"`
			Email string `json:"email"`
			Name  string `json:"name"`
		} `json:"user,omitempty"`
	} `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func cmdLogin() {
	rc, _ := config.LoadGlobal()
	apiBase := defaultAPIBase
	if rc != nil && rc.APIBase != "" {
		apiBase = rc.APIBase
	}

	if rc != nil && rc.Token != "" {
		fmt.Fprintf(os.Stderr, "Already logged in. Use 'continuumm whoami' to check your session.\n")
		fmt.Fprintf(os.Stderr, "To re-authenticate, run: continuumm config set --token \"\" first.\n")
		return
	}

	// Start device auth
	resp, err := http.PostForm(apiBase+"/auth/cli/start", nil)
	if err != nil {
		fatal("Error starting login: %v", err)
	}
	var startRes cliStartResponse
	if err := json.NewDecoder(resp.Body).Decode(&startRes); err != nil {
		resp.Body.Close()
		fatal("Error parsing response: %v", err)
	}
	resp.Body.Close()

	if !startRes.Ok || startRes.Data == nil {
		msg := "unknown error"
		if startRes.Error != nil {
			msg = startRes.Error.Message
		}
		fatal("Login failed: %s", msg)
	}

	deviceCode := startRes.Data.DeviceCode
	userCode := startRes.Data.UserCode
	verificationURI := startRes.Data.VerificationURI
	expiresIn := startRes.Data.ExpiresIn

	fmt.Fprintf(os.Stderr, "\n")
	fmt.Fprintf(os.Stderr, "  First, copy your code: %s\n", userCode)
	fmt.Fprintf(os.Stderr, "\n")
	fmt.Fprintf(os.Stderr, "  Then open in your browser:\n")
	fmt.Fprintf(os.Stderr, "  %s\n", verificationURI)
	fmt.Fprintf(os.Stderr, "\n")

	// Try to open the browser
	if err := openBrowser(verificationURI); err == nil {
		fmt.Fprintf(os.Stderr, "  Browser opened automatically.\n")
	} else {
		fmt.Fprintf(os.Stderr, "  (If the browser didn't open, paste the URL manually.)\n")
	}

	fmt.Fprintf(os.Stderr, "\n")
	fmt.Fprintf(os.Stderr, "  Waiting for you to confirm in the browser...\n")

	// Poll for completion
	pollInterval := 2 * time.Second
	deadline := time.Now().Add(time.Duration(expiresIn) * time.Second)

	for time.Now().Before(deadline) {
		time.Sleep(pollInterval)

		body, _ := json.Marshal(map[string]string{"device_code": deviceCode})
		pollResp, err := http.Post(apiBase+"/auth/cli/poll", "application/json", bytes.NewReader(body))
		if err != nil {
			fmt.Fprintf(os.Stderr, "  Poll error: %v\n", err)
			continue
		}

		var pollRes cliPollResponse
		if err := json.NewDecoder(pollResp.Body).Decode(&pollRes); err != nil {
			pollResp.Body.Close()
			fmt.Fprintf(os.Stderr, "  Parse error: %v\n", err)
			continue
		}
		pollResp.Body.Close()

		if !pollRes.Ok || pollRes.Data == nil {
			continue
		}

		switch pollRes.Data.Status {
		case "pending":
			fmt.Fprintf(os.Stderr, "  still waiting...\r")
		case "confirmed":
			token := pollRes.Data.Token
			user := pollRes.Data.User

			// Save token to config
			if rc == nil {
				rc = &config.RemoteConfig{}
			}
			rc.Token = token
			rc.APIBase = apiBase
			if err := config.SaveGlobal(rc); err != nil {
				fatal("Error saving token: %v", err)
			}

			fmt.Fprintf(os.Stderr, "\n  ✓ Logged in as %s (%s)\n", user.Name, user.Email)
			return
		case "expired":
			fatal("Login code expired. Run 'continuumm login' again.")
		}
	}

	fatal("Login timed out. Run 'continuumm login' again.")
}

func cmdWhoami() {
	rc, err := config.LoadGlobal()
	if err != nil || rc == nil || rc.Token == "" {
		fatal("Not logged in. Run 'continuumm login' first.")
	}

	apiBase := defaultAPIBase
	if rc.APIBase != "" {
		apiBase = rc.APIBase
	}

	req, _ := http.NewRequest("GET", apiBase+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+rc.Token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fatal("Error fetching user info: %v", err)
	}
	defer resp.Body.Close()

	var result struct {
		Ok   bool `json:"ok"`
		Data *struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		fatal("Error parsing response: %v", err)
	}

	if !result.Ok || result.Data == nil {
		msg := "not authenticated"
		if result.Error != nil {
			msg = result.Error.Message
		}
		fatal("Error: %s", msg)
	}

	fmt.Fprintf(os.Stderr, "Logged in as:\n")
	fmt.Fprintf(os.Stderr, "  Name:  %s\n", result.Data.Name)
	fmt.Fprintf(os.Stderr, "  Email: %s\n", result.Data.Email)
	fmt.Fprintf(os.Stderr, "  ID:    %s\n", result.Data.ID)
}

func openBrowser(url string) error {
	switch {
	case exec.Command("open", url).Run() == nil:
		return nil
	case exec.Command("xdg-open", url).Run() == nil:
		return nil
	case exec.Command("cmd", "/c", "start", url).Run() == nil:
		return nil
	}
	return fmt.Errorf("no browser opener found")
}
