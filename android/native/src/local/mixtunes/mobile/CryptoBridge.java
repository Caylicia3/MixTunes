package local.mixtunes.mobile;

import android.util.Base64;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class CryptoBridge {
    private static final SecureRandom random = new SecureRandom();
    private static byte[] bytes(JSONObject data, String key) { byte[] value = Base64.decode(data.optString(key, ""), Base64.DEFAULT); if (value.length > NativeNetwork.MAX_BODY) throw new IllegalArgumentException("加密输入过大"); return value; }
    private static String encoded(byte[] data, String encoding) { if (!"hex".equals(encoding)) return Base64.encodeToString(data, Base64.NO_WRAP); StringBuilder result = new StringBuilder(data.length * 2); for (byte value : data) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255)); return result.toString(); }
    static String execute(String text) {
        try {
            JSONObject data = new JSONObject(text); String op = data.getString("op"); Object value;
            if (op.equals("randomUUID")) value = UUID.randomUUID().toString();
            else if (op.equals("randomInt")) {
                long min = data.optLong("min", 0), max = data.getLong("max"), bound = max - min;
                if (min < 0 || max > 9007199254740991L || bound <= 0) throw new IllegalArgumentException("随机数范围无效");
                long bits, number; do { bits = random.nextLong() >>> 1; number = bits % bound; } while (bits - number + (bound - 1) < 0); value = min + number;
            } else if (op.equals("hash")) {
                String name = data.optString("algorithm", "md5").toLowerCase(java.util.Locale.ROOT);
                if (!name.equals("md5") && !name.equals("sha256") && !name.equals("sha1")) throw new IllegalArgumentException("不支持的摘要算法");
                value = encoded(MessageDigest.getInstance(name.equals("sha256") ? "SHA-256" : name.equals("sha1") ? "SHA-1" : "MD5").digest(bytes(data, "dataBase64")), data.optString("output", "base64"));
            } else if (op.equals("cipher")) {
                String algorithm = data.getString("algorithm").toLowerCase(java.util.Locale.ROOT);
                if (!algorithm.matches("aes-(128|256)-(cbc|ecb)")) throw new IllegalArgumentException("不支持的加密算法");
                byte[] key = bytes(data, "keyBase64"); if (key.length != (algorithm.contains("128") ? 16 : 32)) throw new IllegalArgumentException("密钥长度无效");
                Cipher cipher = Cipher.getInstance(algorithm.endsWith("cbc") ? "AES/CBC/PKCS5Padding" : "AES/ECB/PKCS5Padding");
                int mode = "decrypt".equals(data.optString("operation")) ? Cipher.DECRYPT_MODE : Cipher.ENCRYPT_MODE;
                if (algorithm.endsWith("cbc")) { byte[] iv = bytes(data, "ivBase64"); if (iv.length != 16) throw new IllegalArgumentException("初始向量长度无效"); cipher.init(mode, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv)); }
                else cipher.init(mode, new SecretKeySpec(key, "AES"));
                value = encoded(cipher.doFinal(bytes(data, data.has("inputBase64") ? "inputBase64" : "dataBase64")), data.optString("output", "base64"));
            } else throw new IllegalArgumentException("未知加密操作");
            return Json.object("ok", true, "value", value).toString();
        } catch (Exception error) { return Json.object("ok", false, "error", Json.error(error)).toString(); }
    }
}
