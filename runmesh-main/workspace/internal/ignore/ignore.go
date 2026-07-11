package ignore

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"

	gitignore "github.com/sabhiram/go-gitignore"

	"github.com/rclone/rclone/fs/filter"
)

func LoadDevignore(projectDir string) ([]string, error) {
	f, err := os.Open(filepath.Join(projectDir, ".devignore"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var excludes []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "!") {
			continue
		}
		excludes = append(excludes, line)
	}
	return excludes, scanner.Err()
}

func NewMatcher(projectDir string) (*gitignore.GitIgnore, error) {
	patterns, err := LoadDevignore(projectDir)
	if err != nil {
		return nil, err
	}
	if len(patterns) == 0 {
		return nil, nil
	}
	return gitignore.CompileIgnoreLines(patterns...), nil
}

func ApplyFiltersToFilter(f *filter.Filter, patterns []string) error {
	for _, p := range patterns {
		if err := f.Add(false, p); err != nil {
			return err
		}
	}
	return nil
}
