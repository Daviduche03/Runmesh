package envcrypt

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := GenerateKey()
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	return key
}

func TestIsEnvFile(t *testing.T) {
	yes := []string{".env", ".env.local", ".env.production", ".env.development.local", "sub/dir/.env", "sub/.env.staging", "sub/.env.examples"}
	no := []string{".env.example", ".env.sample", ".env.local.example", "foo.env", ".environment", "env", ".envrc", ".git/config"}
	for _, p := range yes {
		if !IsEnvFile(p) {
			t.Errorf("IsEnvFile(%q) = false, want true", p)
		}
	}
	for _, p := range no {
		if IsEnvFile(p) {
			t.Errorf("IsEnvFile(%q) = true, want false", p)
		}
	}
}

func TestNameRoundtrip(t *testing.T) {
	if got := EncryptedName(".env"); got != ".env.enc" {
		t.Errorf("EncryptedName = %q", got)
	}
	if !IsEncryptedEnvFile("sub/.env.local.enc") {
		t.Error("IsEncryptedEnvFile(sub/.env.local.enc) = false")
	}
	if IsEncryptedEnvFile("sub/.env.example.enc") || IsEncryptedEnvFile("main.go") {
		t.Error("IsEncryptedEnvFile matched a non-env file")
	}
	if got := DecryptedName("sub/.env.enc"); got != "sub/.env" {
		t.Errorf("DecryptedName = %q", got)
	}
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	key := testKey(t)
	plain := []byte("DATABASE_URL=postgres://u:p@host/db\nAPI_KEY=supersecret\n")
	blob, err := Encrypt(key, plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Contains(blob, []byte("supersecret")) {
		t.Fatal("blob contains plaintext")
	}
	if string(blob[:4]) != magic {
		t.Fatal("missing RME1 magic")
	}
	out, err := Decrypt(key, blob)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if !bytes.Equal(out, plain) {
		t.Fatalf("roundtrip mismatch: %q", out)
	}
}

func TestEncryptNonDeterministic(t *testing.T) {
	key := testKey(t)
	plain := []byte("A=1")
	b1, _ := Encrypt(key, plain)
	b2, _ := Encrypt(key, plain)
	if bytes.Equal(b1, b2) {
		t.Fatal("two encryptions produced identical blobs (nonce reuse)")
	}
}

func TestDecryptWrongKey(t *testing.T) {
	k1, k2 := testKey(t), testKey(t)
	blob, _ := Encrypt(k1, []byte("SECRET=1"))
	_, err := Decrypt(k2, blob)
	if err == nil || !strings.Contains(err.Error(), "different key") {
		t.Fatalf("expected different-key error, got %v", err)
	}
}

func TestDecryptTampered(t *testing.T) {
	key := testKey(t)
	blob, _ := Encrypt(key, []byte("SECRET=1"))
	blob[len(blob)-1] ^= 0xff
	if _, err := Decrypt(key, blob); err == nil {
		t.Fatal("tampered blob decrypted without error")
	}
}

func TestTagChangeDetection(t *testing.T) {
	key := testKey(t)
	a1, _ := Encrypt(key, []byte("A=1"))
	a2, _ := Encrypt(key, []byte("A=1"))
	b, _ := Encrypt(key, []byte("A=2"))
	tag1, err := ReadTag(a1)
	if err != nil {
		t.Fatalf("ReadTag: %v", err)
	}
	tag2, _ := ReadTag(a2)
	tagB, _ := ReadTag(b)
	if !bytes.Equal(tag1, tag2) {
		t.Fatal("same plaintext produced different tags across nonces")
	}
	if bytes.Equal(tag1, tagB) {
		t.Fatal("different plaintext produced same tag")
	}
	if !TagEquals(key, []byte("A=1"), tag1) {
		t.Fatal("TagEquals false for matching plaintext")
	}
	if TagEquals(key, []byte("A=1"), tagB) {
		t.Fatal("TagEquals true for wrong plaintext")
	}
	// A blob from another key must not validate against our plaintext
	other := testKey(t)
	ob, _ := otherEncrypt(t, other, []byte("A=1"))
	otag, _ := ReadTag(ob)
	if TagEquals(key, []byte("A=1"), otag) {
		t.Fatal("tag oracle works across keys (should be keyed)")
	}
}

func otherEncrypt(t *testing.T, key, plain []byte) ([]byte, error) {
	t.Helper()
	return Encrypt(key, plain)
}

func TestParseAndResolveKey(t *testing.T) {
	key := testKey(t)
	keyHex := hex.EncodeToString(key)
	parsed, err := ParseKey(keyHex)
	if err != nil || !bytes.Equal(parsed, key) {
		t.Fatalf("ParseKey roundtrip failed: %v", err)
	}
	if _, err := ParseKey("deadbeef"); err == nil {
		t.Fatal("ParseKey accepted short key")
	}
	if _, err := ParseKey("not-hex!"); err == nil {
		t.Fatal("ParseKey accepted non-hex")
	}
	// ResolveKey: env var wins over configured
	t.Setenv(EnvKeyEnvVar, "")
	got, err := ResolveKey(keyHex)
	if err != nil || !bytes.Equal(got, key) {
		t.Fatalf("ResolveKey(configured) failed: %v", err)
	}
	other := testKey(t)
	t.Setenv(EnvKeyEnvVar, hex.EncodeToString(other))
	got, err = ResolveKey(keyHex)
	if err != nil || !bytes.Equal(got, other) {
		t.Fatal("ResolveKey should prefer env var")
	}
	t.Setenv(EnvKeyEnvVar, "")
	got, err = ResolveKey("")
	if err != nil || got != nil {
		t.Fatal("ResolveKey(empty) should return nil key")
	}
}

func TestKeyFingerprint(t *testing.T) {
	key := testKey(t)
	fp := KeyFingerprint(key)
	if len(fp) != keyFPLen*2 {
		t.Fatalf("fingerprint length %d", len(fp))
	}
	if fp == KeyFingerprint(testKey(t)) {
		t.Fatal("fingerprints collide for different keys")
	}
}

func TestReadTagRejectsGarbage(t *testing.T) {
	if _, err := ReadTag([]byte("short")); err == nil {
		t.Fatal("ReadTag accepted short blob")
	}
	bad := make([]byte, HeaderLen+4)
	copy(bad, "XXXX")
	if _, err := ReadTag(bad); err == nil {
		t.Fatal("ReadTag accepted bad magic")
	}
}
