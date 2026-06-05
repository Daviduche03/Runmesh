import hashlib
import hmac
import json
import base64
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

def encode_token(payload: dict, secret: str) -> str:
    raw = json.dumps(payload).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest().encode()
    return base64.urlsafe_b64encode(raw + b"." + signature).decode()

def decode_token(token: str, secret: str) -> dict | None:
    try:
        decoded = base64.urlsafe_b64decode(token.encode())
        raw, sig = decoded.rsplit(b".", 1)
        expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest().encode()
        if not hmac.compare_digest(sig, expected):
            return None
        return json.loads(raw.decode())
    except Exception:
        return None

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    env = request.scope["env"]
    payload = decode_token(token, env.JWT_SECRET)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload
