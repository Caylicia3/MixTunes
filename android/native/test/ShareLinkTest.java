package local.mixtunes.mobile;
public final class ShareLinkTest {
  public static void main(String[] args)throws Exception{
    String token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",base="http://192.168.1.2:43210/share/"+token+"/";
    if(!ShareLink.normalise(base).equals(base+"library.json"))throw new AssertionError("landing path");
    if(!ShareLink.normalise(base+"library.json").equals(base+"library.json"))throw new AssertionError("data path");
    String[] bad={base.replace("192.168.1.2","127.0.0.1"),base.replace("192.168.1.2","8.8.8.8"),base.replace("192.168.1.2","local.example"),base.replace(":43210",":80"),base+"?token=x",base+"../private",base.replace("http:","https:")};
    for(String value:bad){boolean rejected=false;try{ShareLink.normalise(value);}catch(Exception expected){rejected=true;}if(!rejected)throw new AssertionError("untrusted URL accepted");}
    System.out.println("PASS ShareLink landing/data normalization and seven rejected destination classes");
  }
}
