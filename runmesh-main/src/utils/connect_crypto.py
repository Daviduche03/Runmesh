import base64
import hashlib


def _vault_key(secret: str) -> bytes:
    return hashlib.sha256(f"connect-vault:{secret}".encode()).digest()


def encrypt_connect_secret(plaintext: str, secret: str) -> str:
    key = _vault_key(secret)
    data = plaintext.encode()
    encoded = bytes(data[i] ^ key[i % len(key)] for i in range(len(data)))
    return base64.urlsafe_b64encode(encoded).decode()


def decrypt_connect_secret(ciphertext: str | None, secret: str) -> str | None:
    if not ciphertext:
        return None
    try:
        raw = base64.urlsafe_b64decode(ciphertext.encode())
        key = _vault_key(secret)
        decoded = bytes(raw[i] ^ key[i % len(key)] for i in range(len(raw)))
        return decoded.decode()
    except Exception:
        return ciphertext
