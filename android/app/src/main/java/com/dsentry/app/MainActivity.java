package com.dsentry.app;

/*
 * ตัวห่อโปรแกรม DS แลกเงินกีบ ให้เป็นแอป Android
 * -----------------------------------------------------------------------------
 * หน้าเว็บทั้งหมดอยู่ใน assets/www/ และถูกเสิร์ฟผ่าน WebViewAssetLoader ที่
 * https://appassets.androidplatform.net/  (เป็น secure context จริง crypto/worker ใช้ได้ครบ)
 *
 * สิ่งเดียวที่ต้องพึ่ง native คือการอ่าน/เขียนไฟล์ .xlsx ผ่าน Storage Access Framework
 * ซึ่งให้สิทธิ์ "เขียนทับไฟล์เดิม" ที่ผู้ใช้เลือกเอง และจำสิทธิ์ไว้ข้ามการปิดเปิดแอปได้
 *
 * ทุกครั้งที่เขียน จะอ่านไฟล์กลับมาเทียบไบต์ต่อไบต์เสมอ - ผู้ให้บริการบางเจ้า
 * (โดยเฉพาะ OneDrive) รับคำสั่งเขียนแล้วเงียบ ๆ ไม่เขียนจริง จึงเชื่อผลลัพธ์เปล่า ๆ ไม่ได้
 */

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String XLSX_MIME =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private WebView web;
    private WebViewAssetLoader loader;

    /* คำขอที่ค้างอยู่ระหว่างรอผู้ใช้เลือกไฟล์ */
    private int pendingReqId = -1;
    private ActivityResultLauncher<Intent> openLauncher;
    private ActivityResultLauncher<Intent> createLauncher;

    /* สำหรับ <input type="file"> ในหน้าเว็บ (ใช้แนบรูปสลิป) */
    private ValueCallback<Uri[]> fileChooserCallback;
    private ActivityResultLauncher<Intent> chooserLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);                     /* อย่าให้ขนาดฟอนต์ระบบมาทำ layout เพี้ยน */

        WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                /* แอปนี้ไม่มีสิทธิ์ต่อเน็ต - กันไม่ให้หลุดออกนอก assets ไปเจอหน้า error */
                return !req.getUrl().toString().startsWith(ORIGIN);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = cb;
                try {
                    chooserLauncher.launch(params.createIntent());
                    return true;
                } catch (Exception e) {
                    fileChooserCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        openLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), this::onDocumentPicked);
        createLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), this::onDocumentPicked);
        chooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), res -> {
                    if (fileChooserCallback == null) return;
                    fileChooserCallback.onReceiveValue(
                            WebChromeClient.FileChooserParams.parseResult(
                                    res.getResultCode(), res.getData()));
                    fileChooserCallback = null;
                });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });

        web.loadUrl(ORIGIN + "/www/index.html");
    }

    /* ------------------------------------------------- ผลจากตัวเลือกไฟล์ของระบบ */
    private void onDocumentPicked(ActivityResult res) {
        int reqId = pendingReqId;
        pendingReqId = -1;
        JSONObject out = new JSONObject();
        try {
            out.put("reqId", reqId);
            Uri uri = res.getData() == null ? null : res.getData().getData();
            if (res.getResultCode() != RESULT_OK || uri == null) {
                out.put("cancelled", true);
            } else {
                int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try {
                    getContentResolver().takePersistableUriPermission(uri, flags);
                } catch (SecurityException ignored) {
                    /* ผู้ให้บริการบางเจ้าไม่ยอมให้จำสิทธิ์ถาวร - ยังใช้ได้ในรอบนี้ */
                }
                out.put("uri", uri.toString());
                out.put("name", displayNameOf(uri));
                out.put("writable", looksWritable(uri));
            }
        } catch (Exception e) {
            try { out.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
        }
        sendToJs(out);
    }

    private void sendToJs(JSONObject payload) {
        final String js = "window.__androidResult && window.__androidResult("
                + JSONObject.quote(payload.toString()) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /* ------------------------------------------------------------- ตัวช่วยไฟล์ */
    private String displayNameOf(Uri uri) {
        try (Cursor c = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        String p = uri.getLastPathSegment();
        if (p == null) return "workbook.xlsx";
        int i = p.lastIndexOf('/');
        return i >= 0 ? p.substring(i + 1) : p;
    }

    /** ผู้ให้บริการบอกเองว่าไฟล์นี้เขียนทับได้ไหม (ยังไม่ใช่การพิสูจน์ - ต้องลองเขียนจริง) */
    private boolean looksWritable(Uri uri) {
        try (Cursor c = getContentResolver().query(uri,
                new String[]{DocumentsContract.Document.COLUMN_FLAGS}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int flags = c.getInt(0);
                return (flags & DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0;
            }
        } catch (Exception ignored) {}
        return true;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(1 << 16);
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    /* =========================================================== สะพานไปหา JS */
    private class Bridge {

        @JavascriptInterface
        public String version() {
            return "1";
        }

        /** เปิดตัวเลือกไฟล์ของ Android เพื่อหยิบไฟล์ .xlsx (ได้สิทธิ์อ่าน+เขียน) */
        @JavascriptInterface
        public void openWorkbook(int reqId) {
            pendingReqId = reqId;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{XLSX_MIME, "application/octet-stream"});
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            runOnUiThread(() -> openLauncher.launch(i));
        }

        /** สร้างไฟล์ใหม่ (ใช้ตอนไฟล์เดิมเขียนทับไม่ได้ หรือจะเซฟสำเนา) */
        @JavascriptInterface
        public void createWorkbook(int reqId, String suggestedName) {
            pendingReqId = reqId;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(XLSX_MIME);
            i.putExtra(Intent.EXTRA_TITLE, suggestedName);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            runOnUiThread(() -> createLauncher.launch(i));
        }

        /** อ่านไฟล์เป็น base64 */
        @JavascriptInterface
        public String read(String uriString) {
            JSONObject o = new JSONObject();
            try {
                Uri uri = Uri.parse(uriString);
                byte[] data;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new Exception("เปิดไฟล์ไม่ได้");
                    data = readAll(in);
                }
                o.put("ok", true);
                o.put("name", displayNameOf(uri));
                o.put("size", data.length);
                o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            } catch (Exception e) {
                try { o.put("ok", false); o.put("error", String.valueOf(e.getMessage())); }
                catch (Exception ignored) {}
            }
            return o.toString();
        }

        /**
         * เขียนทับไฟล์เดิม แล้วอ่านกลับมาเทียบไบต์ต่อไบต์
         * verified=false หมายถึงเขียนไปแล้วแต่ของในไฟล์ไม่ตรง - ห้ามบอกผู้ใช้ว่าสำเร็จเด็ดขาด
         */
        @JavascriptInterface
        public String write(String uriString, String base64) {
            JSONObject o = new JSONObject();
            byte[] data;
            try {
                data = Base64.decode(base64, Base64.NO_WRAP);
            } catch (Exception e) {
                try { o.put("ok", false); o.put("error", "ข้อมูลที่ส่งมาเสียหาย"); } catch (Exception ignored) {}
                return o.toString();
            }

            Uri uri = Uri.parse(uriString);
            ContentResolver cr = getContentResolver();
            Exception last = null;
            boolean wrote = false;

            /* "wt" = เขียนแล้วตัดท้ายทิ้ง ต้องได้อันนี้ ไม่งั้นไฟล์เก่าที่ยาวกว่าจะเหลือหางค้าง */
            for (String mode : new String[]{"wt", "rwt", "w"}) {
                try (OutputStream os = cr.openOutputStream(uri, mode)) {
                    if (os == null) throw new Exception("openOutputStream คืน null");
                    os.write(data);
                    os.flush();
                    wrote = true;
                    break;
                } catch (Exception e) {
                    last = e;
                }
            }

            try {
                if (!wrote) {
                    o.put("ok", false);
                    o.put("error", last == null ? "เขียนไฟล์ไม่ได้" : String.valueOf(last.getMessage()));
                    return o.toString();
                }
                byte[] back;
                try (InputStream in = cr.openInputStream(uri)) {
                    back = in == null ? new byte[0] : readAll(in);
                }
                o.put("ok", true);
                o.put("verified", Arrays.equals(data, back));
                o.put("size", data.length);
                o.put("sizeOnDisk", back.length);
            } catch (Exception e) {
                try {
                    o.put("ok", true);
                    o.put("verified", false);
                    o.put("error", "เขียนแล้วแต่อ่านกลับมาตรวจไม่ได้: " + e.getMessage());
                } catch (Exception ignored) {}
            }
            return o.toString();
        }

        /** ไฟล์ที่เคยเปิดไว้และยังมีสิทธิ์อยู่ - เอาไว้ทำปุ่ม "เปิดไฟล์ล่าสุด" */
        @JavascriptInterface
        public String recent() {
            JSONArray arr = new JSONArray();
            try {
                List<android.content.UriPermission> ps = getContentResolver().getPersistedUriPermissions();
                for (int i = ps.size() - 1; i >= 0; i--) {
                    android.content.UriPermission p = ps.get(i);
                    if (!p.isReadPermission()) continue;
                    JSONObject o = new JSONObject();
                    o.put("uri", p.getUri().toString());
                    o.put("name", displayNameOf(p.getUri()));
                    o.put("writable", p.isWritePermission());
                    arr.put(o);
                }
            } catch (Exception ignored) {}
            return arr.toString();
        }

        /** เลิกจำไฟล์นั้น */
        @JavascriptInterface
        public void forget(String uriString) {
            try {
                getContentResolver().releasePersistableUriPermission(Uri.parse(uriString),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
    }
}
