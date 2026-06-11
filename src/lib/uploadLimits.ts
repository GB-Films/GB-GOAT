export const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = '2 MB';

export const validateMaxUploadSize = (file?: File | null, label = 'archivo') => {
  if (!file) return '';
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `El ${label} es muy pesado. El maximo permitido es ${MAX_UPLOAD_SIZE_LABEL}.`;
  }
  return '';
};
