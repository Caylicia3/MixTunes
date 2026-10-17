package local.mixtunes.mobile;

import java.net.URI;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class ShareLink {
    static String normalise(String value) throws Exception {
        if(value==null||value.length()>2048)throw new IllegalArgumentException("歌单链接无效");
        URI uri=new URI(value.trim());
        String host=uri.getHost();
        if(!"http".equals(uri.getScheme())||host==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getFragment()!=null||uri.getPort()<1024||uri.getPort()>65535||!host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}"))throw new SecurityException("仅支持同一 Wi-Fi 的电脑歌单链接");
        String[] parts=host.split("\\.");int[] p=new int[4];for(int i=0;i<4;i++){p[i]=Integer.parseInt(parts[i]);if(p[i]<0||p[i]>255)throw new SecurityException("地址无效");}
        if(!(p[0]==10||p[0]==192&&p[1]==168||p[0]==172&&p[1]>=16&&p[1]<=31))throw new SecurityException("仅支持局域网歌单链接");
        if(!uri.getRawPath().matches("/share/[a-f0-9]{48}/(library\\.json)?"))throw new SecurityException("歌单链接无效");
        String path=uri.getRawPath();if(path.endsWith("/"))path+="library.json";
        return new URI("http",null,host,uri.getPort(),path,null,null).toString();
    }
    static JSONObject fetch(String value,RequestControl control) throws Exception {
        String url=normalise(value);control.check();HttpURLConnection c=(HttpURLConnection)new URI(url).toURL().openConnection();
        try{
            control.attach(c);c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setUseCaches(false);c.setRequestMethod("GET");c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","MixTunes-Android/1.0.0");
            int status=c.getResponseCode();control.check();if(status==404||status==410)throw new IllegalStateException("链接已过期，请在电脑上重新生成");if(status!=200)throw new IllegalStateException("无法读取电脑歌单，请检查同一 Wi-Fi 和电脑防火墙");
            if(c.getContentLengthLong()>NativeNetwork.MAX_BODY)throw new IllegalArgumentException("歌单文件大于 12 MB");
            String text=new String(NativeNetwork.read(c.getInputStream(),NativeNetwork.MAX_BODY,control),StandardCharsets.UTF_8);
            return Json.object("text",text);
        }finally{c.disconnect();}
    }
}
