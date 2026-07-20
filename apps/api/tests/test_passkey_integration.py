import hashlib
import json
from uuid import UUID, uuid4

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import ASGITransport, AsyncClient
from logion_api.main import app
from webauthn import verify_authentication_response, verify_registration_response
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, encode_cbor


def _client_data(kind: str, challenge: str, origin: str) -> bytes:
    return json.dumps(
        {
            "type": kind,
            "challenge": challenge,
            "origin": origin,
            "crossOrigin": False,
        },
        separators=(",", ":"),
    ).encode()


def _registration_credential(
    private_key: ec.EllipticCurvePrivateKey,
    credential_id: bytes,
    *,
    rp_id: str,
    origin: str,
    challenge: str,
) -> dict[str, object]:
    public_numbers = private_key.public_key().public_numbers()
    cose_key = encode_cbor(
        {
            1: 2,
            3: -7,
            -1: 1,
            -2: public_numbers.x.to_bytes(32, "big"),
            -3: public_numbers.y.to_bytes(32, "big"),
        }
    )
    authenticator_data = b"".join(
        (
            hashlib.sha256(rp_id.encode()).digest(),
            bytes([0x45]),  # user present, user verified, attested credential data
            (0).to_bytes(4, "big"),
            bytes(16),
            len(credential_id).to_bytes(2, "big"),
            credential_id,
            cose_key,
        )
    )
    attestation_object = encode_cbor(
        {
            "fmt": "none",
            "attStmt": {},
            "authData": authenticator_data,
        }
    )
    client_data = _client_data("webauthn.create", challenge, origin)
    encoded_id = bytes_to_base64url(credential_id)
    return {
        "id": encoded_id,
        "rawId": encoded_id,
        "type": "public-key",
        "clientExtensionResults": {},
        "response": {
            "clientDataJSON": bytes_to_base64url(client_data),
            "attestationObject": bytes_to_base64url(attestation_object),
            "transports": ["internal", "hybrid"],
        },
    }


def _authentication_credential(
    private_key: ec.EllipticCurvePrivateKey,
    credential_id: bytes,
    user_id: UUID,
    *,
    rp_id: str,
    origin: str,
    challenge: str,
    sign_count: int,
) -> dict[str, object]:
    authenticator_data = b"".join(
        (
            hashlib.sha256(rp_id.encode()).digest(),
            bytes([0x05]),  # user present and user verified
            sign_count.to_bytes(4, "big"),
        )
    )
    client_data = _client_data("webauthn.get", challenge, origin)
    signed_data = authenticator_data + hashlib.sha256(client_data).digest()
    signature = private_key.sign(signed_data, ec.ECDSA(hashes.SHA256()))
    encoded_id = bytes_to_base64url(credential_id)
    return {
        "id": encoded_id,
        "rawId": encoded_id,
        "type": "public-key",
        "clientExtensionResults": {},
        "response": {
            "clientDataJSON": bytes_to_base64url(client_data),
            "authenticatorData": bytes_to_base64url(authenticator_data),
            "signature": bytes_to_base64url(signature),
            "userHandle": bytes_to_base64url(user_id.bytes),
        },
    }


def test_software_passkey_fixture_has_valid_attestation_and_assertion() -> None:
    rp_id = "test"
    origin = "http://test"
    user_id = uuid4()
    private_key = ec.generate_private_key(ec.SECP256R1())
    credential_id = uuid4().bytes + uuid4().bytes
    registration_challenge = uuid4().bytes + uuid4().bytes
    registration = _registration_credential(
        private_key,
        credential_id,
        rp_id=rp_id,
        origin=origin,
        challenge=bytes_to_base64url(registration_challenge),
    )

    registered = verify_registration_response(
        credential=registration,
        expected_challenge=registration_challenge,
        expected_rp_id=rp_id,
        expected_origin=origin,
        require_user_verification=True,
    )
    assert registered.credential_id == credential_id

    authentication_challenge = uuid4().bytes + uuid4().bytes
    authentication = _authentication_credential(
        private_key,
        credential_id,
        user_id,
        rp_id=rp_id,
        origin=origin,
        challenge=bytes_to_base64url(authentication_challenge),
        sign_count=1,
    )
    authenticated = verify_authentication_response(
        credential=authentication,
        expected_challenge=authentication_challenge,
        expected_rp_id=rp_id,
        expected_origin=origin,
        credential_public_key=registered.credential_public_key,
        credential_current_sign_count=registered.sign_count,
        require_user_verification=True,
    )
    assert authenticated.credential_id == base64url_to_bytes(str(authentication["rawId"]))
    assert authenticated.new_sign_count == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_passkey_registration_login_replay_and_revocation() -> None:
    origin = "http://test"
    headers = {"Origin": origin}
    email = f"passkey-{uuid4()}@example.com"
    private_key = ec.generate_private_key(ec.SECP256R1())
    credential_id = uuid4().bytes + uuid4().bytes

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as password_client:
        registered_user = await password_client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Password browser",
            },
        )
        assert registered_user.status_code == 201, registered_user.text
        user_id = UUID(registered_user.json()["user"]["id"])
        csrf = password_client.cookies["logion_csrf"]

        tampered_options_response = await password_client.post(
            "/api/v1/auth/passkeys/register/options",
            headers={"X-CSRF-Token": csrf},
        )
        assert tampered_options_response.status_code == 200
        tampered_options = tampered_options_response.json()
        tampered_public_key = tampered_options["public_key"]
        tampered_credential = _registration_credential(
            private_key,
            credential_id,
            rp_id=tampered_public_key["rp"]["id"],
            origin="http://other.test",
            challenge=tampered_public_key["challenge"],
        )
        rejected_origin = await password_client.post(
            "/api/v1/auth/passkeys/register/verify",
            headers={"X-CSRF-Token": csrf},
            json={
                "challenge_id": tampered_options["challenge_id"],
                "name": "Wrong origin",
                "credential": tampered_credential,
            },
        )
        assert rejected_origin.status_code == 422
        assert rejected_origin.json()["code"] == "AUTH_PASSKEY_VERIFICATION_FAILED"

        options_response = await password_client.post(
            "/api/v1/auth/passkeys/register/options",
            headers={"X-CSRF-Token": csrf},
        )
        assert options_response.status_code == 200, options_response.text
        registration_options = options_response.json()
        public_key = registration_options["public_key"]
        assert public_key["authenticatorSelection"] == {
            "residentKey": "required",
            "requireResidentKey": True,
            "userVerification": "required",
        }

        registration_credential = _registration_credential(
            private_key,
            credential_id,
            rp_id=public_key["rp"]["id"],
            origin=origin,
            challenge=public_key["challenge"],
        )
        verified_registration = await password_client.post(
            "/api/v1/auth/passkeys/register/verify",
            headers={"X-CSRF-Token": csrf},
            json={
                "challenge_id": registration_options["challenge_id"],
                "name": "Laptop Passkey",
                "credential": registration_credential,
            },
        )
        assert verified_registration.status_code == 201, verified_registration.text
        passkey_id = verified_registration.json()["id"]
        assert verified_registration.json()["name"] == "Laptop Passkey"
        assert verified_registration.json()["transports"] == ["internal", "hybrid"]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as passkey_client:
        login_options_response = await passkey_client.post(
            "/api/v1/auth/passkeys/login/options"
        )
        assert login_options_response.status_code == 200, login_options_response.text
        login_options = login_options_response.json()
        login_public_key = login_options["public_key"]
        assert login_public_key["allowCredentials"] == []
        assert login_public_key["userVerification"] == "required"

        authentication_credential = _authentication_credential(
            private_key,
            credential_id,
            user_id,
            rp_id=login_public_key["rpId"],
            origin=origin,
            challenge=login_public_key["challenge"],
            sign_count=1,
        )
        authenticated = await passkey_client.post(
            "/api/v1/auth/passkeys/login/verify",
            json={
                "challenge_id": login_options["challenge_id"],
                "device_name": "Passkey browser",
                "credential": authentication_credential,
            },
        )
        assert authenticated.status_code == 200, authenticated.text
        assert authenticated.json()["user"]["id"] == str(user_id)
        assert "logion_access" in passkey_client.cookies

        replayed = await passkey_client.post(
            "/api/v1/auth/passkeys/login/verify",
            json={
                "challenge_id": login_options["challenge_id"],
                "device_name": "Passkey browser",
                "credential": authentication_credential,
            },
        )
        assert replayed.status_code == 401
        assert replayed.json()["code"] == "AUTH_PASSKEY_CHALLENGE_INVALID"

        regression_options_response = await passkey_client.post(
            "/api/v1/auth/passkeys/login/options"
        )
        assert regression_options_response.status_code == 200
        regression_options = regression_options_response.json()
        regression_public_key = regression_options["public_key"]
        regressed_credential = _authentication_credential(
            private_key,
            credential_id,
            user_id,
            rp_id=regression_public_key["rpId"],
            origin=origin,
            challenge=regression_public_key["challenge"],
            sign_count=1,
        )
        regressed = await passkey_client.post(
            "/api/v1/auth/passkeys/login/verify",
            json={
                "challenge_id": regression_options["challenge_id"],
                "device_name": "Cloned Passkey",
                "credential": regressed_credential,
            },
        )
        assert regressed.status_code == 401
        assert regressed.json()["code"] == "AUTH_PASSKEY_INVALID"

        compromised_credentials = await passkey_client.get("/api/v1/auth/passkeys")
        assert compromised_credentials.status_code == 200
        assert compromised_credentials.json()["credentials"] == []

        csrf = passkey_client.cookies["logion_csrf"]
        revoked = await passkey_client.delete(
            f"/api/v1/auth/passkeys/{passkey_id}",
            headers={"X-CSRF-Token": csrf},
        )
        assert revoked.status_code == 200, revoked.text

        credentials = await passkey_client.get("/api/v1/auth/passkeys")
        assert credentials.status_code == 200
        assert credentials.json()["credentials"] == []

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as revoked_client:
        next_options_response = await revoked_client.post(
            "/api/v1/auth/passkeys/login/options"
        )
        assert next_options_response.status_code == 200
        next_options = next_options_response.json()
        next_public_key = next_options["public_key"]
        revoked_credential = _authentication_credential(
            private_key,
            credential_id,
            user_id,
            rp_id=next_public_key["rpId"],
            origin=origin,
            challenge=next_public_key["challenge"],
            sign_count=2,
        )
        rejected = await revoked_client.post(
            "/api/v1/auth/passkeys/login/verify",
            json={
                "challenge_id": next_options["challenge_id"],
                "device_name": "Revoked browser",
                "credential": revoked_credential,
            },
        )
        assert rejected.status_code == 401
        assert rejected.json()["code"] == "AUTH_PASSKEY_INVALID"
