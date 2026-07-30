package sync

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs"

	"runmesh/workspace/internal/envcrypt"
)

func setupDevice(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func openRemote(t *testing.T) (context.Context, fs.Fs, string) {
	t.Helper()
	ctx := context.Background()
	remoteDir := t.TempDir()
	rfs, err := fs.NewFs(ctx, remoteDir)
	if err != nil {
		t.Fatalf("opening remote: %v", err)
	}
	return ctx, rfs, remoteDir
}

func readRemote(t *testing.T, remoteDir, rel string) ([]byte, bool) {
	data, err := os.ReadFile(filepath.Join(remoteDir, filepath.FromSlash(rel)))
	if os.IsNotExist(err) {
		return nil, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return data, true
}

func TestPushPullEnvRoundtrip(t *testing.T) {
	key, _ := envcrypt.GenerateKey()
	dev1 := setupDevice(t, map[string]string{
		".env":         "SECRET=one\n",
		".env.local":   "LOCAL=1\n",
		".env.example": "SECRET=\n",
		"src/.env":     "NESTED=yes\n",
		"src/main.go":  "package main\n",
	})
	ctx, rfs, remoteDir := openRemote(t)

	if err := PushEnv(ctx, dev1, rfs, key, nil); err != nil {
		t.Fatalf("PushEnv: %v", err)
	}
	// Ciphertext exists for each env file; example file is NOT encrypted
	for _, rel := range []string{".env.enc", ".env.local.enc", "src/.env.enc"} {
		blob, ok := readRemote(t, remoteDir, rel)
		if !ok {
			t.Fatalf("missing remote %s", rel)
		}
		if string(blob[:4]) != "RME1" {
			t.Fatalf("remote %s is not an RME1 blob", rel)
		}
	}
	if _, ok := readRemote(t, remoteDir, ".env.example.enc"); ok {
		t.Fatal(".env.example must not be encrypted")
	}
	// No plaintext anywhere in the remote
	err := filepath.Walk(remoteDir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		data, _ := os.ReadFile(p)
		if len(data) > 0 && (string(data[:min(6, len(data))]) == "SECRET" || string(data[:min(5, len(data))]) == "LOCAL") {
			t.Errorf("plaintext found in remote file %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Second device pulls and decrypts
	dev2 := setupDevice(t, map[string]string{})
	if err := PullEnv(ctx, dev2, rfs, key); err != nil {
		t.Fatalf("PullEnv: %v", err)
	}
	for rel, want := range map[string]string{".env": "SECRET=one\n", ".env.local": "LOCAL=1\n", "src/.env": "NESTED=yes\n"} {
		data, err := os.ReadFile(filepath.Join(dev2, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("dev2 missing %s: %v", rel, err)
		}
		if string(data) != want {
			t.Fatalf("dev2 %s = %q, want %q", rel, data, want)
		}
		info, _ := os.Stat(filepath.Join(dev2, filepath.FromSlash(rel)))
		if info.Mode().Perm() != 0600 {
			t.Fatalf("dev2 %s mode = %o, want 0600", rel, info.Mode().Perm())
		}
	}
}

func TestPushEnvChangeDetectionAndDeletion(t *testing.T) {
	key, _ := envcrypt.GenerateKey()
	dev1 := setupDevice(t, map[string]string{".env": "A=1\n"})
	ctx, rfs, remoteDir := openRemote(t)

	push := func() {
		if err := PushEnv(ctx, dev1, rfs, key, nil); err != nil {
			t.Fatalf("PushEnv: %v", err)
		}
	}
	push()
	blob1, _ := readRemote(t, remoteDir, ".env.enc")

	// Unchanged content → no re-upload (same blob)
	push()
	blob2, _ := readRemote(t, remoteDir, ".env.enc")
	if string(blob1) != string(blob2) {
		t.Fatal("unchanged .env was re-uploaded")
	}

	// Changed content → re-upload (new blob), tag updated
	if err := os.WriteFile(filepath.Join(dev1, ".env"), []byte("A=2\n"), 0600); err != nil {
		t.Fatal(err)
	}
	push()
	blob3, _ := readRemote(t, remoteDir, ".env.enc")
	if string(blob2) == string(blob3) {
		t.Fatal("changed .env was not re-uploaded")
	}

	// Deleted local .env → remote blob removed
	if err := os.Remove(filepath.Join(dev1, ".env")); err != nil {
		t.Fatal(err)
	}
	push()
	if _, ok := readRemote(t, remoteDir, ".env.enc"); ok {
		t.Fatal("remote .env.enc not deleted after local delete")
	}
}

func TestPullEnvWrongKeySkips(t *testing.T) {
	k1, _ := envcrypt.GenerateKey()
	k2, _ := envcrypt.GenerateKey()
	dev1 := setupDevice(t, map[string]string{".env": "SECRET=x\n"})
	ctx, rfs, _ := openRemote(t)
	if err := PushEnv(ctx, dev1, rfs, k1, nil); err != nil {
		t.Fatalf("PushEnv: %v", err)
	}
	dev2 := setupDevice(t, map[string]string{})
	// Pull with wrong key must not write anything (warns and skips)
	if err := PullEnv(ctx, dev2, rfs, k2); err != nil {
		t.Fatalf("PullEnv: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dev2, ".env")); !os.IsNotExist(err) {
		t.Fatal("wrong key pull wrote plaintext")
	}
}

func TestPushEnvNoKeySkips(t *testing.T) {
	dev1 := setupDevice(t, map[string]string{".env": "SECRET=x\n"})
	ctx, rfs, remoteDir := openRemote(t)
	if err := PushEnv(ctx, dev1, rfs, nil, nil); err != nil {
		t.Fatalf("PushEnv: %v", err)
	}
	if _, ok := readRemote(t, remoteDir, ".env.enc"); ok {
		t.Fatal("env file uploaded without a key (must be skipped, never plaintext)")
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
