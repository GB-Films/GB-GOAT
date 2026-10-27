import { getFunctions, httpsCallable } from "firebase/functions";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  reauthenticateWithPopup,
  inMemoryPersistence,
  setPersistence,
  signInWithCustomToken,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import { personalSignatureFields } from "./portalSigning";

export async function portalRequest(
  input: Record<string, unknown>,
): Promise<any> {
  if (
    [
      "prepareRepresentation",
      "prepareProfile",
      "prepareThirdParty",
      "revokeThirdParty",
      "uploadInvoice",
    ].includes(String(input.action))
  ) {
    const user = auth.currentUser;
    if (!user) throw Error("Iniciá sesión.");
    const session = await user.getIdTokenResult();
    if (Date.now() / 1000 - Number(session.claims.auth_time || 0) > 540) {
      await reauthenticateWithPopup(user, googleProvider);
    }
  }
  return (
    await httpsCallable(
      getFunctions(auth.app, "us-central1"),
      "providerPortal",
    )(input)
  ).data;
}
export async function portalAdminRequest(
  input: Record<string, unknown>,
): Promise<any> {
  return (
    await httpsCallable(
      getFunctions(auth.app, "us-central1"),
      "manageProviderPortal",
    )(input)
  ).data;
}
export function downloadPortalFile(
  file: { base64: string; contentType: string; fileName: string },
  preview = false,
) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: file.contentType }),
  );
  if (!preview) {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return url;
}
export async function signPortalDocument(
  doc: any,
  input: {
    dni: string;
    typedName: string;
    signatureType?: "typed" | "drawn";
    signatureImage?: string;
    fieldId?: string;
  },
) {
  const actor = auth.currentUser;
  if (!actor) throw Error("Iniciá sesión.");
  const fields = personalSignatureFields(doc.signatureFields, actor.email || "");
  const field = fields.find(f => f.id === input.fieldId);
  if (!doc.signed && !field)
    throw Error("Seleccioná un recuadro de firma asignado a tu cuenta.");
  const { config } = await portalRequest({ action: "signingSession" });
  const app =
    getApps().find((a) => a.name === "provider-portal-sign") ||
    initializeApp(config, "provider-portal-sign");
  const remoteAuth = getAuth(app);
  await setPersistence(remoteAuth, inMemoryPersistence);
  const remote = getFunctions(app, "us-central1");
  const session = (
    await httpsCallable(
      remote,
      "exchangeGoatSession",
    )({ goatIdToken: await actor.getIdToken(true) })
  ).data as { customToken: string };
  // A second app retains the GOAT session. The short-lived exchange never appears in a URL or storage.
  await signInWithCustomToken(remoteAuth, session.customToken);
  try {
    if (doc.signed)
      return (
        await httpsCallable(
          remote,
          "generateDocumentArtifacts",
        )({ projectId: doc.projectId, docId: doc.documentId })
      ).data;
    return (
      await httpsCallable(
        remote,
        "signDocument",
      )({
        projectId: doc.projectId,
        docId: doc.documentId,
        requestId: doc.id,
        fieldId: field.id,
        documentSha256: doc.sha256,
        signatureType: input.signatureType || "typed",
        signatureImage: input.signatureImage || "",
        dni: input.dni,
        typedName: input.typedName,
        clientEvidence: {
          userAgent: navigator.userAgent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
        },
        acceptedText:
          "Declaro que revisé este documento y acepto firmarlo electrónicamente con mi cuenta verificada, dejando constancia de mi identidad declarada, fecha y evidencia asociada al documento.",
      })
    ).data;
  } catch (error: any) {
    // A previous attempt may have recorded the signature but failed generating its artifacts.
    if (error.code !== "functions/already-exists") throw error;
    return (
      await httpsCallable(
        remote,
        "generateDocumentArtifacts",
      )({ projectId: doc.projectId, docId: doc.documentId })
    ).data;
  } finally {
    await remoteAuth.signOut();
  }
}
