import java.lang.reflect.*;

public class ProbeAPI4 {
    public static void main(String[] args) {
        try {
            Class<?> SC = Class.forName("android.view.SurfaceControl");

            // 1. Try getDynamicDisplayInfo with the real physical display ID
            long physId = 4627039422300187648L;
            System.out.println("=== getDynamicDisplayInfo(" + physId + ") ===");
            try {
                Method m = SC.getDeclaredMethod("getDynamicDisplayInfo", long.class);
                m.setAccessible(true);
                Object info = m.invoke(null, physId);
                if (info != null) {
                    System.out.println("  SUCCESS! Got DynamicDisplayInfo");
                    Class<?> DDI = info.getClass();
                    Object[] modes = (Object[]) DDI.getField("supportedDisplayModes").get(info);
                    int activeId = DDI.getField("activeDisplayModeId").getInt(info);
                    System.out.println("  activeDisplayModeId=" + activeId);
                    Class<?> DM = Class.forName("android.view.SurfaceControl$DisplayMode");
                    for (Object mode : modes) {
                        int id = DM.getField("id").getInt(mode);
                        int w = DM.getField("width").getInt(mode);
                        int h = DM.getField("height").getInt(mode);
                        float rr = DM.getField("peakRefreshRate").getFloat(mode);
                        System.out.printf("    id=%d %dx%d %.1f Hz%s%n",
                            id, w, h, rr, id == activeId ? " *" : "");
                    }
                } else {
                    System.out.println("  null result");
                }
            } catch (Exception e) {
                System.out.println("  Error: " + e);
            }

            // 2. Try ISurfaceComposer AIDL
            System.out.println("\n=== ISurfaceComposer AIDL ===");
            try {
                Class<?> ISC = Class.forName("android.gui.ISurfaceComposer");
                System.out.println("  Found ISurfaceComposer!");
                for (Method m : ISC.getDeclaredMethods()) {
                    String name = m.getName();
                    if (name.contains("display") || name.contains("Display") ||
                        name.contains("token") || name.contains("Token") ||
                        name.contains("physical") || name.contains("Physical") ||
                        name.contains("mode") || name.contains("Mode")) {
                        System.out.println("    " + m.getReturnType().getSimpleName() + " " + name + "(" +
                            formatParams(m.getParameterTypes()) + ")");
                    }
                }
                
                // Check Stub and Proxy
                try {
                    Class<?> Stub = Class.forName("android.gui.ISurfaceComposer$Stub");
                    System.out.println("  Found Stub class");
                    Method asInterface = Stub.getDeclaredMethod("asInterface", 
                        Class.forName("android.os.IBinder"));
                    asInterface.setAccessible(true);
                    
                    // Get the SurfaceFlinger binder
                    Class<?> SM = Class.forName("android.os.ServiceManager");
                    Method getService = SM.getDeclaredMethod("getService", String.class);
                    getService.setAccessible(true);
                    Object sfBinder = getService.invoke(null, "SurfaceFlinger");
                    
                    Object isc = asInterface.invoke(null, sfBinder);
                    System.out.println("  Got ISurfaceComposer proxy: " + isc);
                    
                    if (isc != null) {
                        // Try getPhysicalDisplayIds
                        try {
                            Method gpdids = ISC.getDeclaredMethod("getPhysicalDisplayIds");
                            gpdids.setAccessible(true);
                            Object ids = gpdids.invoke(isc);
                            System.out.println("  getPhysicalDisplayIds: " + ids);
                            if (ids != null && ids.getClass().isArray()) {
                                int len = java.lang.reflect.Array.getLength(ids);
                                for (int i = 0; i < len; i++) {
                                    System.out.println("    [" + i + "] = " + java.lang.reflect.Array.get(ids, i));
                                }
                            }
                        } catch (Exception e) {
                            System.out.println("  getPhysicalDisplayIds error: " + e.getMessage());
                        }
                        
                        // Try getPhysicalDisplayToken
                        try {
                            Method gpdt = ISC.getDeclaredMethod("getPhysicalDisplayToken", long.class);
                            gpdt.setAccessible(true);
                            Object token = gpdt.invoke(isc, physId);
                            System.out.println("  getPhysicalDisplayToken(" + physId + "): " + token);
                        } catch (Exception e) {
                            System.out.println("  getPhysicalDisplayToken error: " + e.getMessage());
                        }
                    }
                } catch (Exception e) {
                    System.out.println("  Stub error: " + e);
                    e.printStackTrace(System.err);
                }
            } catch (ClassNotFoundException e) {
                System.out.println("  ISurfaceComposer not found");
            }
            
            // 3. Try android.gui.DisplayModeSpecs
            System.out.println("\n=== Check android.gui classes ===");
            for (String cn : new String[]{"android.gui.DisplayModeSpecs", 
                    "android.gui.ISurfaceComposerClient",
                    "android.gui.DisplayInfo"}) {
                try {
                    Class<?> c = Class.forName(cn);
                    System.out.println("  " + cn + " - FOUND");
                } catch (ClassNotFoundException e) {
                    System.out.println("  " + cn + " - not found");
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    
    static String formatParams(Class<?>[] params) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < params.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(params[i].getSimpleName());
        }
        return sb.toString();
    }
}
