import base64
import hashlib
import hmac
import secrets

# Format versioning: "v2." = authenticated encryption (HMAC-CTR + Encrypt-then-MAC).
# Legacy values (no prefix) used the old repeating-XOR scheme and are only
# supported for decryption so existing rows keep working until re-written.
_V2_PREFIX = "v2."
_IV_LEN = 16
_TAG_LEN = 32


def _vault_keys(secret: str) -> tuple[bytes, bytes]:
    """Derive separate encryption and MAC keys from the vault secret."""
    master = hashlib.sha256(f"connect-vault:{secret}".encode()).digest()
    enc_key = hmac.new(master, b"connect-vault/enc", hashlib.sha256).digest()
    mac_key = hmac.new(master, b"connect-vault/mac", hashlib.sha256).digest()
    return enc_key, mac_key


def _keystream(enc_key: bytes, iv: bytes, length: int) -> bytes:
    """HMAC-CTR keystream: block_i = HMAC(enc_key, iv || counter_i)."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(
            hmac.new(enc_key, iv + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        )
        counter += 1
    return bytes(out[:length])


def _legacy_key(secret: str) -> bytes:
    return hashlib.sha256(f"connect-vault:{secret}".encode()).digest()


def encrypt_connect_secret(plaintext: str, secret: str) -> str:
    enc_key, mac_key = _vault_keys(secret)
    data = plaintext.encode()
    iv = secrets.token_bytes(_IV_LEN)
    stream = _keystream(enc_key, iv, len(data))
    ciphertext = bytes(d ^ s for d, s in zip(data, stream))
    tag = hmac.new(mac_key, iv + ciphertext, hashlib.sha256).digest()
    return _V2_PREFIX + base64.urlsafe_b64encode(iv + tag + ciphertext).decode()


def decrypt_connect_secret(ciphertext: str | None, secret: str) -> str | None:
    if not ciphertext:
        return None
    if ciphertext.startswith(_V2_PREFIX):
        try:
            raw = base64.urlsafe_b64decode(ciphertext[len(_V2_PREFIX):].encode())
            iv, tag, body = raw[:_IV_LEN], raw[_IV_LEN:_IV_LEN + _TAG_LEN], raw[_IV_LEN + _TAG_LEN:]
            _, mac_key = _vault_keys(secret)
            expected = hmac.new(mac_key, iv + body, hashlib.sha256).digest()
            if not hmac.compare_digest(tag, expected):
                return None
            enc_key, _ = _vault_keys(secret)
            stream = _keystream(enc_key, iv, len(body))
            return bytes(c ^ s for c, s in zip(body, stream)).decode()
        except Exception:
            return None
    # Legacy repeating-XOR values (read-only fallback; re-encrypt on next write)
    try:
        raw = base64.urlsafe_b64decode(ciphertext.encode())
        key = _legacy_key(secret)
        decoded = bytes(raw[i] ^ key[i % len(key)] for i in range(len(raw)))
        return decoded.decode()
    except Exception:
        return None
