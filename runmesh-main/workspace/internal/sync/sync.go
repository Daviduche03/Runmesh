package sync

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/filter"
	"github.com/rclone/rclone/fs/log"
	rclonesync "github.com/rclone/rclone/fs/sync"
	"github.com/rclone/rclone/fs/walk"

	_ "github.com/rclone/rclone/backend/all"

	"runmesh/workspace/internal/config"
	"runmesh/workspace/internal/ignore"
)

func Init() {
	log.InitLogging()
	configfile.Install()
}

func setupCtx(projectDir string) (context.Context, error) {
	ctx := context.Background()
	ctx, ci := fs.AddConfig(ctx)
	ci.Checkers = 16
	ci.Transfers = 8

	patterns, err := ignore.LoadDevignore(projectDir)
	if err != nil {
		return nil, fmt.Errorf("loading .devignore: %w", err)
	}

	ctx, fi := filter.AddConfig(ctx)
	if err := ignore.ApplyFiltersToFilter(fi, patterns); err != nil {
		return nil, fmt.Errorf("applying filters: %w", err)
	}

	accounting.Start(ctx)
	return ctx, nil
}

func Up(projectDir string, r *config.RemoteConfig, p *config.ProjectConfig) error {
	ctx, err := setupCtx(projectDir)
	if err != nil {
		return err
	}

	src, err := fs.NewFs(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("opening local dir: %w", err)
	}

	dst, err := p.OpenRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("opening remote: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Pushing %s → cloud (%s)...\n", projectDir, p.CloudPath(r))
	if err := rclonesync.CopyDir(ctx, dst, src, false); err != nil {
		return fmt.Errorf("sync up: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Done.\n")
	return nil
}

func Down(projectDir string, r *config.RemoteConfig, p *config.ProjectConfig) error {
	ctx, err := setupCtx(projectDir)
	if err != nil {
		return err
	}

	src, err := p.OpenRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("opening remote: %w", err)
	}

	dst, err := fs.NewFs(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("opening local dir: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Pulling cloud (%s) → %s...\n", p.CloudPath(r), projectDir)
	if err := rclonesync.CopyDir(ctx, dst, src, false); err != nil {
		return fmt.Errorf("sync down: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Done.\n")
	return nil
}

func List(projectDir string, r *config.RemoteConfig, p *config.ProjectConfig) error {
	ctx, err := setupCtx(projectDir)
	if err != nil {
		return err
	}

	rfs, err := p.OpenRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("opening remote: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Files in cloud (%s):\n", p.CloudPath(r))
	count := 0
	err = walk.Walk(ctx, rfs, "", false, -1, func(path string, entries fs.DirEntries, err error) error {
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if obj, ok := entry.(fs.Object); ok {
				fmt.Println(obj.Remote())
				count++
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("listing remote: %w", err)
	}
	if count == 0 {
		fmt.Fprintln(os.Stderr, "(empty)")
	} else {
		fmt.Fprintf(os.Stderr, "\n%d files\n", count)
	}
	return nil
}

func Status(projectDir string, r *config.RemoteConfig, p *config.ProjectConfig) error {
	ctx, err := setupCtx(projectDir)
	if err != nil {
		return err
	}

	lfs, err := fs.NewFs(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("opening local dir: %w", err)
	}

	locals := map[string]bool{}
	if err := walk.Walk(ctx, lfs, "", false, -1, func(path string, entries fs.DirEntries, err error) error {
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if _, ok := entry.(fs.Object); ok {
				locals[entry.Remote()] = true
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("walking local: %w", err)
	}

	rfs, err := p.OpenRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("opening remote: %w", err)
	}

	remotes := map[string]bool{}
	if err := walk.Walk(ctx, rfs, "", false, -1, func(path string, entries fs.DirEntries, err error) error {
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if _, ok := entry.(fs.Object); ok {
				remotes[entry.Remote()] = true
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("walking remote: %w", err)
	}

	var push, pull []string
	for p := range locals {
		if !remotes[p] {
			push = append(push, p)
		}
	}
	for p := range remotes {
		if !locals[p] {
			pull = append(pull, p)
		}
	}
	sort.Strings(push)
	sort.Strings(pull)

	same := len(locals) + len(remotes) - len(push) - len(pull)

	fmt.Fprintf(os.Stderr, "Status for %s:\n", projectDir)
	fmt.Fprintf(os.Stderr, "  Local:  %d files\n", len(locals))
	fmt.Fprintf(os.Stderr, "  Remote: %d files\n", len(remotes))
	fmt.Fprintf(os.Stderr, "  Same:   %d files\n", same/2)

	if len(push) > 0 {
		fmt.Fprintf(os.Stderr, "\nWould push (local → cloud):\n")
		for _, p := range push {
			fmt.Fprintf(os.Stderr, "  + %s\n", p)
		}
	}
	if len(pull) > 0 {
		fmt.Fprintf(os.Stderr, "\nWould pull (cloud → local):\n")
		for _, p := range pull {
			fmt.Fprintf(os.Stderr, "  + %s\n", p)
		}
	}
	if len(push) == 0 && len(pull) == 0 {
		fmt.Fprintln(os.Stderr, "Synced.")
	}
	return nil
}

func Watch(projectDir string, r *config.RemoteConfig, p *config.ProjectConfig) error {
	matcher, err := ignore.NewMatcher(projectDir)
	if err != nil {
		return fmt.Errorf("loading .devignore: %w", err)
	}

	ctx := context.Background()
	ctx, ci := fs.AddConfig(ctx)
	ci.Checkers = 8
	ci.Transfers = 4

	lfs, err := fs.NewFs(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("opening local dir: %w", err)
	}

	rfs, err := p.OpenRemote(ctx, r)
	if err != nil {
		return fmt.Errorf("opening remote: %w", err)
	}

	// initial sync: push local → cloud, then pull cloud → local
	if err := rclonesync.CopyDir(ctx, rfs, lfs, false); err != nil {
		return fmt.Errorf("initial push: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Pushed local → cloud.\n")
	if err := rclonesync.CopyDir(ctx, lfs, rfs, false); err != nil {
		return fmt.Errorf("initial pull: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Pulled cloud → local.\n")

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("creating watcher: %w", err)
	}
	defer watcher.Close()

	addDir := func(path string) {
		rel, _ := filepath.Rel(projectDir, path)
		if rel != "" && matcher != nil && matcher.MatchesPath(rel) {
			return
		}
		watcher.Add(path)
	}

	filepath.Walk(projectDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			addDir(path)
		}
		return nil
	})

	localDirty := false
	pushTick := time.NewTicker(500 * time.Millisecond)
	pullTick := time.NewTicker(8 * time.Second)
	defer pushTick.Stop()
	defer pullTick.Stop()

	fmt.Fprintf(os.Stderr, "Watching %s (push on change, pull every 8s)...\n", projectDir)

	for {
		select {
		case event := <-watcher.Events:
			if matcher != nil {
				rel, _ := filepath.Rel(projectDir, event.Name)
				if rel != "" && matcher.MatchesPath(rel) {
					continue
				}
			}
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					filepath.Walk(event.Name, func(path string, info os.FileInfo, err error) error {
						if err != nil {
							return err
						}
						if info.IsDir() {
							addDir(path)
						}
						return nil
					})
				}
			}
			localDirty = true

		case <-pushTick.C:
			if !localDirty {
				continue
			}
			localDirty = false
			if err := rclonesync.CopyDir(ctx, rfs, lfs, false); err != nil {
				fmt.Fprintf(os.Stderr, "push error: %v\n", err)
			}

		case <-pullTick.C:
			if err := rclonesync.CopyDir(ctx, lfs, rfs, false); err != nil {
				fmt.Fprintf(os.Stderr, "pull error: %v\n", err)
			}

		case err := <-watcher.Errors:
			fmt.Fprintf(os.Stderr, "watch error: %v\n", err)
		}
	}
}
