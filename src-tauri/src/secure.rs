use base64::{engine::general_purpose::STANDARD, Engine};
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

fn blob_to_vec(blob: &CRYPT_INTEGER_BLOB) -> Vec<u8> {
    // SAFETY: DPAPI guarantees pbData points to cbData valid bytes until LocalFree.
    let bytes = unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize) }.to_vec();
    unsafe {
        let _ = LocalFree(Some(HLOCAL(blob.pbData as *mut _)));
    }
    bytes
}

/// Encrypts text with the current user's Windows DPAPI key; returns base64.
#[tauri::command]
pub fn dpapi_protect(text: String) -> Result<String, String> {
    let mut data = text.into_bytes();
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_mut_ptr() };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|e| e.to_string())?;
    }
    Ok(STANDARD.encode(blob_to_vec(&output)))
}

#[tauri::command]
pub fn dpapi_unprotect(encoded: String) -> Result<String, String> {
    let mut data = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_mut_ptr() };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|e| e.to_string())?;
    }
    String::from_utf8(blob_to_vec(&output)).map_err(|e| e.to_string())
}
