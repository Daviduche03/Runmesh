package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
)

type RemoteConfig struct {
	Provider      string `json:"provider,omitempty"`
	Endpoint      string `json:"endpoint,omitempty"`
	Region        string `json:"region,omitempty"`
	AccessKey     string `json:"access_key,omitempty"`
	SecretKey     string `json:"secret_key,omitempty"`
	DefaultBucket string `json:"default_bucket,omitempty"`
	Token         string `json:"token,omitempty"`
	APIBase       string `json:"api_base,omitempty"`
	// EnvKey is the hex-encoded 32-byte key for client-side .env encryption.
	// It never leaves the device (only ciphertext is uploaded).
	EnvKey string `json:"env_key,omitempty"`
}

type ProjectConfig struct {
	Prefix string `json:"prefix"`
}

const configDirName = ".runmesh"

func RunmeshDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, configDirName), nil
}

func GlobalPath() (string, error) {
	dir, err := RunmeshDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

func ProjectDir(projectDir string) string {
	return filepath.Join(projectDir, configDirName)
}

func ProjectPath(projectDir string) string {
	return filepath.Join(ProjectDir(projectDir), "config.json")
}

func LoadGlobal() (*RemoteConfig, error) {
	p, err := GlobalPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading global config: %w", err)
	}
	var cfg RemoteConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing global config: %w", err)
	}
	return &cfg, nil
}

func SaveGlobal(cfg *RemoteConfig) error {
	dir, err := RunmeshDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("creating config dir: %w", err)
	}
	p, err := GlobalPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding global config: %w", err)
	}
	return os.WriteFile(p, data, 0600)
}

func LoadProject(projectDir string) (*ProjectConfig, error) {
	data, err := os.ReadFile(ProjectPath(projectDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading project config: %w", err)
	}
	var cfg ProjectConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing project config: %w", err)
	}
	return &cfg, nil
}

func SaveProject(projectDir string, cfg *ProjectConfig) error {
	dir := ProjectDir(projectDir)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating project config dir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding project config: %w", err)
	}
	return os.WriteFile(ProjectPath(projectDir), data, 0644)
}

func (p *ProjectConfig) CloudPath(r *RemoteConfig) string {
	return fmt.Sprintf("%s/%s", r.DefaultBucket, p.Prefix)
}

func (p *ProjectConfig) OpenRemote(ctx context.Context, r *RemoteConfig) (fs.Fs, error) {
	return r.NewFs(ctx, r.DefaultBucket, p.Prefix)
}

func (r *RemoteConfig) NewFs(ctx context.Context, bucket, prefix string) (fs.Fs, error) {
	ri, err := fs.Find("s3")
	if err != nil {
		return nil, fmt.Errorf("finding s3 backend: %w", err)
	}

	userCfg := configmap.Simple{
		"provider":          r.Provider,
		"access_key_id":     r.AccessKey,
		"secret_access_key": r.SecretKey,
		"region":            r.Region,
		"endpoint":          r.Endpoint,
		"env_auth":          "false",
		"no_check_bucket":   "true",
		"force_path_style":  "true",
	}

	cfg := fs.ConfigMap(ri.Prefix, ri.Options, "runmesh", userCfg)
	return ri.NewFs(ctx, "runmesh", bucket+"/"+prefix, cfg)
}
