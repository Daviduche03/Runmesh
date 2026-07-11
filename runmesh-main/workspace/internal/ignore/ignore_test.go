package ignore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDevignore(t *testing.T) {
	dir := t.TempDir()
	content := `
# this is a comment
node_modules/
.git/
build/

!important.txt
*.log

`
	if err := os.WriteFile(filepath.Join(dir, ".devignore"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	patterns, err := LoadDevignore(dir)
	if err != nil {
		t.Fatal(err)
	}

	expected := []string{"node_modules/", ".git/", "build/", "*.log"}
	if len(patterns) != len(expected) {
		t.Fatalf("got %d patterns, want %d: %v", len(patterns), len(expected), patterns)
	}
	for i, p := range expected {
		if patterns[i] != p {
			t.Errorf("pattern[%d] = %q, want %q", i, patterns[i], p)
		}
	}
}

func TestLoadDevignoreMissing(t *testing.T) {
	dir := t.TempDir()
	patterns, err := LoadDevignore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if patterns != nil {
		t.Fatalf("expected nil, got %v", patterns)
	}
}

func TestLoadDevignoreEmpty(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".devignore"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}
	patterns, err := LoadDevignore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(patterns) != 0 {
		t.Fatalf("expected 0 patterns, got %d", len(patterns))
	}
}
