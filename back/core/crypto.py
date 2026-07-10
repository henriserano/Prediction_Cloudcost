"""Cryptography primitives used by the auth / credentials features.

Layered design:

1. **PIN hashing** — Argon2id (via argon2-cffi). We store only the hash; the
   raw PIN never leaves the request that provided it. Argon2 params default to
   the library's memory-hard preset, slow enough to make offline brute-force
   of a 6-digit PIN take minutes per attempt on a laptop (still trivial with
   dedicated hardware; hence the "POC only" warning surfaced in the UI).

2. **Key-Encryption-Key (KEK)** — 32 random bytes generated once at user
   creation. It's the actual key encrypting the credentials. We store it
   in DynamoDB, itself wrapped with AES-GCM using a key derived from the PIN
   (PBKDF2-HMAC-SHA256, 600k iterations — OWASP 2023 baseline).
   Rationale: rotating the PIN only re-wraps the KEK, so credentials never
   need to be re-encrypted from scratch.

3. **Credentials encryption** — AES-GCM with the KEK, per-record random
   96-bit nonce, 128-bit auth tag. Ciphertext + nonce stored as base64.
"""
from __future__ import annotations

import base64
import os
from dataclasses import dataclass

from argon2 import PasswordHasher, exceptions as argon2_exceptions
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


_KEK_LEN = 32
_NONCE_LEN = 12
_PBKDF2_ITER = 600_000
_PBKDF2_SALT_LEN = 16


_hasher = PasswordHasher()


def smoke_test_argon2() -> None:
    """Verify argon2-cffi is importable AND functional at startup.

    Called from the FastAPI lifespan. A missing/broken C extension (common on
    freshly-built Alpine images that skipped ``argon2-cffi-bindings``) will
    surface here as a startup crash instead of a 500 on the first ``/signup``.
    """
    probe = _hasher.hash("smoke-test-000000")
    if not _hasher.verify(probe, "smoke-test-000000"):
        raise RuntimeError("Argon2 self-verification returned False")


# ---------------------------------------------------------------------------
# PIN hashing
# ---------------------------------------------------------------------------

def hash_pin(pin: str) -> str:
    """Argon2id hash of the PIN. Return value already includes salt+params."""
    return _hasher.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    """Constant-time verify. Never raises — always returns bool."""
    try:
        _hasher.verify(pin_hash, pin)
        return True
    except argon2_exceptions.VerifyMismatchError:
        return False
    except argon2_exceptions.InvalidHashError:
        return False


# ---------------------------------------------------------------------------
# KEK generation + wrapping with PIN-derived key
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WrappedKek:
    """PIN-encrypted Key-Encryption-Key, ready to store in DynamoDB."""

    ciphertext_b64: str
    nonce_b64: str
    salt_b64: str


def _derive_key_from_pin(pin: str, salt: bytes) -> bytes:
    """PBKDF2-HMAC-SHA256 → 32-byte key. Same parameters both sides."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=_PBKDF2_ITER,
    )
    return kdf.derive(pin.encode("utf-8"))


def create_wrapped_kek(pin: str) -> tuple[WrappedKek, bytes]:
    """Generate a new KEK, wrap it with the PIN. Return (wrapped, raw_kek).

    The raw KEK is returned so the caller can encrypt anything they hold in
    memory during the same request without a redundant unwrap.
    """
    raw_kek = os.urandom(_KEK_LEN)
    salt = os.urandom(_PBKDF2_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    kek_wrap_key = _derive_key_from_pin(pin, salt)
    ciphertext = AESGCM(kek_wrap_key).encrypt(nonce, raw_kek, associated_data=None)
    return (
        WrappedKek(
            ciphertext_b64=base64.b64encode(ciphertext).decode("ascii"),
            nonce_b64=base64.b64encode(nonce).decode("ascii"),
            salt_b64=base64.b64encode(salt).decode("ascii"),
        ),
        raw_kek,
    )


def unwrap_kek(pin: str, wrapped: WrappedKek) -> bytes | None:
    """Return the raw KEK, or ``None`` if the PIN is wrong / ciphertext broken."""
    try:
        salt = base64.b64decode(wrapped.salt_b64)
        nonce = base64.b64decode(wrapped.nonce_b64)
        ct = base64.b64decode(wrapped.ciphertext_b64)
        key = _derive_key_from_pin(pin, salt)
        return AESGCM(key).decrypt(nonce, ct, associated_data=None)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Credential encryption with the raw KEK
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EncryptedBlob:
    ciphertext_b64: str
    nonce_b64: str


def encrypt_with_kek(kek: bytes, plaintext: str, associated_data: bytes | None = None) -> EncryptedBlob:
    """AES-GCM encrypt. Associated data (e.g. b"gcp") binds the ciphertext
    to a context — flipping the DynamoDB ``provider`` key won't authenticate."""
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(kek).encrypt(nonce, plaintext.encode("utf-8"), associated_data)
    return EncryptedBlob(
        ciphertext_b64=base64.b64encode(ct).decode("ascii"),
        nonce_b64=base64.b64encode(nonce).decode("ascii"),
    )


def decrypt_with_kek(kek: bytes, blob: EncryptedBlob, associated_data: bytes | None = None) -> str | None:
    """Return plaintext, or ``None`` on any decryption failure (wrong KEK,
    tampered ciphertext, wrong AAD)."""
    try:
        nonce = base64.b64decode(blob.nonce_b64)
        ct = base64.b64decode(blob.ciphertext_b64)
        return AESGCM(kek).decrypt(nonce, ct, associated_data).decode("utf-8")
    except Exception:
        return None
