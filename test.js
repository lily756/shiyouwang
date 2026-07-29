const CryptoJS = require("crypto-js");

function encryptMcdField(value, aesKey) {
  return CryptoJS.AES.encrypt(
    String(value),
    CryptoJS.enc.Utf8.parse(aesKey),
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    },
  ).ciphertext.toString();
}

const tel = encryptMcdField("你的手机号", process.env.MCD_LOGIN_AES_KEY);
const code = encryptMcdField("123456", process.env.MCD_LOGIN_AES_KEY);