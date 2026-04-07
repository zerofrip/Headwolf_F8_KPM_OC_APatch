import java.lang.reflect.*;

/**
 * SurfaceFlinger display-mode bypass utility.
 * Obtains the display token via raw Binder IPC to SurfaceFlingerAIDL,
 * then calls SurfaceControl.{get,set}DesiredDisplayModeSpecs via reflection.
 * Bypasses DisplayManagerService and MTK HWC policy overrides.
 *
 * Usage (via app_process):
 *   app_process -Djava.class.path=/path/to/setdisplaymode.dex /system/bin SetDisplayMode <cmd> [args]
 *
 * Commands:
 *   modes                              - list available display modes
 *   get                                - show current SF display mode specs
 *   set <modeId> <renderMin> <renderMax> - set display mode + render range
 */
public class SetDisplayMode {

    static final String SF_DESCRIPTOR = "android.gui.ISurfaceComposer";
    /* AIDL transaction code for getPhysicalDisplayToken on Android 16 */
    static final int TX_GET_DISPLAY_TOKEN = 7;

    static Class<?> SC, IB;

    public static void main(String[] args) {
        try {
            SC = Class.forName("android.view.SurfaceControl");
            IB = Class.forName("android.os.IBinder");

            long displayId = getPrimaryDisplayId();
            Object token   = getDisplayToken(displayId);
            if (token == null) {
                System.err.println("ERROR: could not obtain display token");
                System.exit(1);
            }

            String cmd = args.length > 0 ? args[0] : "get";

            switch (cmd) {
                case "modes":
                    listModes(displayId);
                    break;
                case "get":
                    printSpecs(getSpecs(token));
                    break;
                case "set":
                    if (args.length < 4) { usage(); System.exit(1); }
                    int   modeId = Integer.parseInt(args[1]);
                    float rMin   = Float.parseFloat(args[2]);
                    float rMax   = Float.parseFloat(args[3]);
                    doSet(token, modeId, rMin, rMax);
                    break;
                default:
                    usage();
            }
        } catch (Exception e) {
            System.err.println("ERROR: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }
    }

    /* ── display ID via DynamicDisplayInfo ───────────────── */

    static long getPrimaryDisplayId() throws Exception {
        /* Try the Java wrapper first (may work on some builds) */
        try {
            long[] ids = (long[]) call(SC, null, "getPhysicalDisplayIds");
            if (ids != null && ids.length > 0) return ids[0];
        } catch (NoSuchMethodException ignored) {}

        /* Fallback: parse from DisplayManagerGlobal */
        try {
            Class<?> DMG = Class.forName("android.hardware.display.DisplayManagerGlobal");
            Object dmg   = DMG.getDeclaredMethod("getInstance").invoke(null);
            Object info  = DMG.getDeclaredMethod("getDisplayInfo", int.class)
                              .invoke(dmg, 0 /* DEFAULT_DISPLAY */);
            Class<?> DI  = info.getClass();
            /* uniqueId = "local:<physId>" */
            String uid = (String) DI.getField("uniqueId").get(info);
            if (uid != null && uid.startsWith("local:"))
                return Long.parseLong(uid.substring(6));
        } catch (Exception ignored) {}

        throw new RuntimeException("cannot determine primary display ID");
    }

    /* ── display token via raw Binder IPC ───────────────── */

    static Object getDisplayToken(long displayId) throws Exception {
        /* Try SurfaceControl wrapper first */
        try {
            return call(SC, null, "getPhysicalDisplayToken",
                        new Class<?>[]{long.class}, displayId);
        } catch (NoSuchMethodException ignored) {}

        /* Android 16+: use raw Binder transact to SurfaceFlingerAIDL */
        Class<?> SM     = Class.forName("android.os.ServiceManager");
        Object   sfBinder = SM.getDeclaredMethod("getService", String.class)
                              .invoke(null, "SurfaceFlingerAIDL");

        Class<?> Parcel = Class.forName("android.os.Parcel");
        Object   data   = Parcel.getDeclaredMethod("obtain").invoke(null);
        Object   reply  = Parcel.getDeclaredMethod("obtain").invoke(null);

        Parcel.getDeclaredMethod("writeInterfaceToken", String.class)
              .invoke(data, SF_DESCRIPTOR);
        Parcel.getDeclaredMethod("writeLong", long.class)
              .invoke(data, displayId);

        IB.getDeclaredMethod("transact", int.class, Parcel, Parcel, int.class)
          .invoke(sfBinder, TX_GET_DISPLAY_TOKEN, data, reply, 0);

        Parcel.getDeclaredMethod("readException").invoke(reply);
        Object token = Parcel.getDeclaredMethod("readStrongBinder").invoke(reply);

        Parcel.getDeclaredMethod("recycle").invoke(data);
        Parcel.getDeclaredMethod("recycle").invoke(reply);
        return token;
    }

    /* ── list display modes ─────────────────────────────── */

    static void listModes(long displayId) throws Exception {
        Class<?> DDI = Class.forName(
                "android.view.SurfaceControl$DynamicDisplayInfo");
        Class<?> DM  = Class.forName(
                "android.view.SurfaceControl$DisplayMode");

        Object info  = call(SC, null, "getDynamicDisplayInfo",
                new Class<?>[]{long.class}, displayId);
        Object[] modes = (Object[]) DDI.getField("supportedDisplayModes").get(info);
        int activeId   = DDI.getField("activeDisplayModeId").getInt(info);

        for (Object m : modes) {
            int   id = DM.getField("id").getInt(m);
            int   w  = DM.getField("width").getInt(m);
            int   h  = DM.getField("height").getInt(m);
            float rr = DM.getField("peakRefreshRate").getFloat(m);
            System.out.printf("  id=%d  %dx%d  %.1f Hz%s%n",
                    id, w, h, rr, id == activeId ? "  *" : "");
        }
    }

    /* ── get / print specs ──────────────────────────────── */

    static Object getSpecs(Object token) throws Exception {
        return call(SC, null, "getDesiredDisplayModeSpecs",
                new Class<?>[]{IB}, token);
    }

    static void printSpecs(Object specs) throws Exception {
        Class<?> DMS = specs.getClass();
        Class<?> RRs = Class.forName(
                "android.view.SurfaceControl$RefreshRateRanges");
        Class<?> RR  = Class.forName(
                "android.view.SurfaceControl$RefreshRateRange");

        int dm = DMS.getField("defaultMode").getInt(specs);
        Object pr   = DMS.getField("primaryRanges").get(specs);
        Object phys = RRs.getField("physical").get(pr);
        Object rend = RRs.getField("render").get(pr);

        System.out.println("defaultMode=" + dm);
        System.out.printf("primary.physical=[%.1f,%.1f]%n",
                RR.getField("min").getFloat(phys),
                RR.getField("max").getFloat(phys));
        System.out.printf("primary.render=[%.1f,%.1f]%n",
                RR.getField("min").getFloat(rend),
                RR.getField("max").getFloat(rend));

        try {
            Object idle = DMS.getField("idleScreenRefreshRateConfig").get(specs);
            if (idle != null) {
                Class<?> ISRRC = idle.getClass();
                for (Field f : ISRRC.getDeclaredFields()) {
                    f.setAccessible(true);
                    System.out.println("idle." + f.getName() + "=" + f.get(idle));
                }
            }
        } catch (NoSuchFieldException ignored) {}
    }

    /* ── set specs ──────────────────────────────────────── */

    static void doSet(Object token,
                      int modeId, float rMin, float rMax) throws Exception {

        Class<?> DMS   = Class.forName(
                "android.view.SurfaceControl$DesiredDisplayModeSpecs");
        Class<?> RR    = Class.forName(
                "android.view.SurfaceControl$RefreshRateRange");
        Class<?> RRs   = Class.forName(
                "android.view.SurfaceControl$RefreshRateRanges");

        Constructor<?> rrC  = RR.getDeclaredConstructor(float.class, float.class);
        rrC.setAccessible(true);
        Constructor<?> rrsC = RRs.getDeclaredConstructor(RR, RR);
        rrsC.setAccessible(true);

        Object pPhys = rrC.newInstance(0f, rMax);
        Object pRend = rrC.newInstance(rMin, rMax);
        Object aPhys = rrC.newInstance(0f, rMax);
        Object aRend = rrC.newInstance(0f, rMax);

        Object primary  = rrsC.newInstance(pPhys, pRend);
        Object appReq   = rrsC.newInstance(aPhys, aRend);

        /* Preserve current idle-screen config if possible */
        Object idleConfig = null;
        try {
            Object cur = getSpecs(token);
            idleConfig = DMS.getField("idleScreenRefreshRateConfig").get(cur);
        } catch (Exception ignored) {}

        Class<?> ISRRC = Class.forName(
                "android.view.SurfaceControl$IdleScreenRefreshRateConfig");

        Constructor<?> dmsC = DMS.getDeclaredConstructor(
                int.class, boolean.class, RRs, RRs, ISRRC);
        dmsC.setAccessible(true);
        Object specs = dmsC.newInstance(modeId, false, primary, appReq, idleConfig);

        call(SC, null, "setDesiredDisplayModeSpecs",
                new Class<?>[]{IB, DMS}, token, specs);

        System.out.printf("OK mode=%d render=[%.0f,%.0f]%n", modeId, rMin, rMax);
    }

    /* ── reflection helpers ─────────────────────────────── */

    static Object call(Class<?> cls, Object obj, String name,
                       Class<?>[] pt, Object... a) throws Exception {
        Method m = cls.getDeclaredMethod(name, pt);
        m.setAccessible(true);
        return m.invoke(obj, a);
    }

    static Object call(Class<?> cls, Object obj, String name)
            throws Exception {
        Method m = cls.getDeclaredMethod(name);
        m.setAccessible(true);
        return m.invoke(obj);
    }

    static void usage() {
        System.out.println("Usage:");
        System.out.println("  modes                              - list display modes");
        System.out.println("  get                                - show current SF specs");
        System.out.println("  set <modeId> <renderMin> <renderMax> - set mode + render range");
    }
}
