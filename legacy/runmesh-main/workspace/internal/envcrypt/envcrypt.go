// Package envcrypt implements client-side (zero-knowledge) encryption for
// .env files. Plaintext env files never leave the device: they are encrypted
// with a per-user key before upload and only decrypted after download.
// The key never touches the cloud.
//
// Blob format (all lengths in bytes):
//
//	"RME1" (4) | key fingerprint (8) | plaintext tag (16) | nonce (12) | AES-256-GCM ciphertext+tag
//
// The plaintext tag is HMAC-SHA256(key, "envtag"||plaintext), truncated. Only
// key holders can compute it, so devices can detect "did this file change?"
// without decrypting and without giving outsiders a plaintext-hash oracle.
package envcrypt

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	magic    = "RME1" // Runmesh Env format v1
	keyFPLen = 8
	tagLen   = 16
	nonceLen = 12
	// HeaderLen is magic + fingerprint + tag + nonce.
	HeaderLen = 4 + keyFPLen + tagLen + nonceLen
	// KeyLen is the required key length (AES-256).
	KeyLen = 32
	// EncSuffix is appended to env file names in the cloud.
	EncSuffix = ".enc"
	// EnvKeyEnvVar overrides the configured key (useful for CI/agents).
	EnvKeyEnvVar = "RUNMESH_ENV_KEY"
)

// GenerateKey returns a new random 32-byte key.
func GenerateKey() ([]byte, error) {
	key := make([]byte, KeyLen)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generating key: %w", err)
	}
	return key, nil
}

// KeyFingerprint returns a short, non-secret identifier for a key.
func KeyFingerprint(key []byte) string {
	fp := sha256.Sum256(key)
	return hex.EncodeToString(fp[:keyFPLen])
}

// ParseKey validates and decodes a hex-encoded key string.
func ParseKey(raw string) ([]byte, error) {
	key, err := hex.DecodeString(strings.TrimSpace(raw))
	if err != nil || len(key) != KeyLen {
		return nil, fmt.Errorf("expected %d hex chars (%d bytes)", KeyLen*2, KeyLen)
	}
	return key, nil
}

// ResolveKey returns the active key: RUNMESH_ENV_KEY wins over the configured
// hex key. Returns (nil, nil) when no key is configured anywhere.
func ResolveKey(configuredHex string) ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv(EnvKeyEnvVar))
	if raw == "" {
		raw = strings.TrimSpace(configuredHex)
	}
	if raw == "" {
		return nil, nil
	}
	key, err := ParseKey(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid env key: %w", err)
	}
	return key, nil
}

// IsEnvFile reports whether a slash-separated relative path is a syncable
// env file. Templates meant to be shared (.env.example/.sample) are excluded.
func IsEnvFile(rel string) bool {
	base := filepath.Base(filepath.FromSlash(rel))
	if base == ".env" {
		return true
	}
	if !strings.HasPrefix(base, ".env.") {
		return false
	}
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, ".example") || strings.HasSuffix(lower, ".sample") {
		return false
	}
	return true
}

// EncryptedName maps ".env" → ".env.enc" (path stays alongside the original).
func EncryptedName(rel string) string { return rel + EncSuffix }

// IsEncryptedEnvFile reports whether a remote name is an encrypted env blob.
func IsEncryptedEnvFile(remote string) bool {
	return strings.HasSuffix(remote, EncSuffix) && IsEnvFile(strings.TrimSuffix(remote, EncSuffix))
}

// DecryptedName maps ".env.enc" → ".env".
func DecryptedName(remote string) string { return strings.TrimSuffix(remote, EncSuffix) }

func plainTag(key, plaintext []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("envtag"))
	mac.Write(plaintext)
	return mac.Sum(nil)[:tagLen]
}

// TagEquals reports whether plaintext matches a tag read from a blob header.
func TagEquals(key, plaintext, tag []byte) bool {
	if len(tag) != tagLen {
		return false
	}
	return hmac.Equal(plainTag(key, plaintext), tag)
}

// ReadTag extracts the plaintext tag from a blob header (no decryption).
func ReadTag(blob []byte) ([]byte, error) {
	if len(blob) < HeaderLen {
		return nil, fmt.Errorf("blob too short (%d bytes)", len(blob))
	}
	if string(blob[:4]) != magic {
		return nil, fmt.Errorf("not an RME1 blob")
	}
	return blob[4+keyFPLen : 4+keyFPLen+tagLen], nil
}

// Encrypt seals plaintext with AES-256-GCM and wraps it in the RME1 format.
func Encrypt(key, plaintext []byte) ([]byte, error) {
	if len(key) != KeyLen {
		return nil, fmt.Errorf("invalid key length %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generating nonce: %w", err)
	}
	fp := sha256.Sum256(key)
	out := make([]byte, 0, HeaderLen+len(plaintext)+gcm.Overhead())
	out = append(out, magic...)
	out = append(out, fp[:keyFPLen]...)
	out = append(out, plainTag(key, plaintext)...)
	out = append(out, nonce...)
	out = gcm.Seal(out, nonce, plaintext, nil)
	return out, nil
}

// Decrypt opens an RME1 blob. It fails with a descriptive error when the blob
// was encrypted with a different key, and with an auth error on tampering.
func Decrypt(key, blob []byte) ([]byte, error) {
	if len(key) != KeyLen {
		return nil, fmt.Errorf("invalid key length %d", len(key))
	}
	if len(blob) < HeaderLen+16 {
		return nil, fmt.Errorf("blob too short to be an RME1 file")
	}
	if string(blob[:4]) != magic {
		return nil, fmt.Errorf("not an RME1 file (bad magic)")
	}
	fp := sha256.Sum256(key)
	if !bytes.Equal(blob[4:4+keyFPLen], fp[:keyFPLen]) {
		return nil, fmt.Errorf("encrypted with a different key (blob fingerprint %s)", hex.EncodeToString(blob[4:4+keyFPLen]))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := blob[HeaderLen-nonceLen : HeaderLen]
	plain, err := gcm.Open(nil, nonce, blob[HeaderLen:], nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed (corrupt or tampered data)")
	}
	return plain, nil
}
