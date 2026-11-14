import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const manifest=read("app/src/main/AndroidManifest.xml");
const listener=read("app/src/main/java/app/fina/casal/FinaPixNotificationListener.java");
const settings=read("app/src/main/java/app/fina/casal/FinaPixSettingsActivity.java");
const parser=read("app/src/main/java/app/fina/casal/FinaPixAlertParser.java");
const web=read("web/index.html");

test("provisional Pix requires BOTH explicit in-app consent and OS notification access",()=>{
 assert.match(manifest,/android.permission.BIND_NOTIFICATION_LISTENER_SERVICE/);
 assert.match(manifest,/android.permission.POST_NOTIFICATIONS/);
 assert.match(manifest,/FinaPixSettingsActivity/);
 assert.match(manifest,/android:scheme="fina" android:host="pix-alerts"/);
 assert.match(listener,/getBoolean\(ENABLED, false\)/);
 assert.match(settings,/setOnCheckedChangeListener/);
 assert.match(settings,/Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS/);
 assert.match(settings,/requestPermissions/);
});

test("only official bank packages, no SMS, no copy of banking notification to server",()=>{
 for(const p of ["com.santander.app","com.nu.production","com.itau","com.bradesco"])
   assert.ok(parser.includes('"'+p+'"'),p);
 assert.match(listener,/FinaPixAlertParser.detect/);
 assert.match(listener,/getSharedPreferences\(PREFS, Context.MODE_PRIVATE\)/);
 assert.match(listener,/MessageDigest.getInstance\("SHA-256"\)/);
 assert.match(listener,/Notification.VISIBILITY_PRIVATE/);
 assert.match(listener,/Possível Pix recebido · não confirmado/);
 assert.doesNotMatch(listener,/https?:\/\//);
 assert.doesNotMatch(listener,/URLConnection|HttpURLConnection|OkHttp|Supabase|\.insert\(|\.upsert\(/);
 assert.doesNotMatch(listener,/\.putString\(".*(?:title|body|amount|description)/);
});

test("app displays provisional and confirmed movements separately",()=>{
 assert.match(web,/Avisos antecipados de Pix \(Android\)/);
 assert.match(web,/fina:\/\/pix-alerts/);
 assert.match(web,/não alteram Entrou, Saiu nem saldo/);
});
