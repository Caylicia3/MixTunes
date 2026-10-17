package local.mixtunes.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

final class Json {
    private Json() {}
    static JSONObject object(Object... pairs) {
        JSONObject result = new JSONObject();
        try { for (int i = 0; i + 1 < pairs.length; i += 2) result.put(String.valueOf(pairs[i]), pairs[i + 1] == null ? JSONObject.NULL : pairs[i + 1]); }
        catch (Exception ignored) {}
        return result;
    }
    static String error(Throwable error) {
        String value = error == null ? "操作失败" : error.getMessage();
        if (value == null || value.trim().isEmpty()) value = error == null ? "操作失败" : error.getClass().getSimpleName();
        value = value.replaceAll("https?://[^\\s]+", "[来源地址]").replaceAll("(?i)(cookie|authorization|SESSDATA|authst)\\s*[:=]\\s*\\S+", "[登录信息]");
        return value.substring(0, Math.min(400, value.length()));
    }
}
