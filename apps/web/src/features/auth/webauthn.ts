import { ApiError } from "@/lib/api";

function b64url(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function creationOptions(options: unknown): PublicKeyCredentialCreationOptions {
  const wrapped = options as { publicKey?: PublicKeyCredentialCreationOptionsJSON };
  const json = wrapped.publicKey ?? (options as PublicKeyCredentialCreationOptionsJSON);
  return PublicKeyCredential.parseCreationOptionsFromJSON(json);
}

function requestOptions(options: unknown): PublicKeyCredentialRequestOptions {
  const wrapped = options as { publicKey?: PublicKeyCredentialRequestOptionsJSON };
  const json = wrapped.publicKey ?? (options as PublicKeyCredentialRequestOptionsJSON);
  return PublicKeyCredential.parseRequestOptionsFromJSON(json);
}

/** Serialize a WebAuthn credential to the JSON shape webauthn-rs expects. */
function serialize(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response;
  const body: Record<string, unknown> = {
    id: credential.id,
    rawId: b64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: { clientDataJSON: b64url(response.clientDataJSON) },
  };
  if (response instanceof AuthenticatorAttestationResponse) {
    (body.response as Record<string, unknown>).attestationObject = b64url(
      response.attestationObject,
    );
    const transports = response.getTransports?.();
    if (transports && transports.length > 0) {
      (body.response as Record<string, unknown>).transports = transports;
    }
  } else if (response instanceof AuthenticatorAssertionResponse) {
    (body.response as Record<string, unknown>).authenticatorData = b64url(
      response.authenticatorData,
    );
    (body.response as Record<string, unknown>).signature = b64url(response.signature);
    (body.response as Record<string, unknown>).userHandle = response.userHandle
      ? b64url(response.userHandle)
      : null;
  }
  return body;
}

export function webauthnSupported(): boolean {
  return (
    typeof window !== "undefined" && !!navigator.credentials && "PublicKeyCredential" in window
  );
}

export async function createPasskey(options: unknown): Promise<Record<string, unknown>> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: creationOptions(options),
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("NoCredential");
    return serialize(credential);
  } catch (error) {
    throw new ApiError(0, "WEBAUTHN", true, error instanceof Error ? error.name : "");
  }
}

export async function getPasskey(options: unknown): Promise<Record<string, unknown>> {
  try {
    const credential = (await navigator.credentials.get({
      publicKey: requestOptions(options),
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("NoCredential");
    return serialize(credential);
  } catch (error) {
    throw new ApiError(0, "WEBAUTHN", true, error instanceof Error ? error.name : "");
  }
}
