const ALLOWED_POP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf"
]);

export function extractInboundMedia(message) {
  if (message.type === "image" && message.image) {
    return {
      mediaId: message.image.id,
      mimeType: message.image.mime_type ?? "image/jpeg",
      sha256: message.image.sha256,
      caption: message.image.caption
    };
  }

  if (message.type === "document" && message.document) {
    return {
      mediaId: message.document.id,
      mimeType: message.document.mime_type,
      sha256: message.document.sha256,
      filename: message.document.filename,
      caption: message.document.caption
    };
  }

  return null;
}

export function isAllowedPopMedia(media) {
  return Boolean(media?.mediaId && ALLOWED_POP_MIME_TYPES.has(media.mimeType));
}
