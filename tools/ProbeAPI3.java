import java.lang.reflect.*;

public class ProbeAPI3 {
    public static void main(String[] args) {
        try {
            Class<?> SC = Class.forName("android.view.SurfaceControl");

            // 1. Try getDynamicDisplayInfo with display ID 0
            System.out.println("=== Try getDynamicDisplayInfo(0) ===");
            try {
                Method m = SC.getDeclaredMethod("getDynamicDisplayInfo", long.class);
                m.setAccessible(true);
                Object info = m.invoke(null, 0L);
                if (info != null) {
                    System.out.println("  Got info: " + info);
                    Class<?> DDI = info.getClass();
                    for (Field f : DDI.getDeclaredFields()) {
                        f.setAccessible(true);
                        Object val = f.get(info);
                        if (val != null && val.getClass().isArray()) {
                            System.out.println("  " + f.getName() + " = [" + java.lang.reflect.Array.getLength(val) + " elements]");
                        } else {
                            System.out.println("  " + f.getName() + " = " + val);
                        }
                    }
                } else {
                    System.out.println("  null result");
                }
            } catch (Exception e) {
                System.out.println("  Error: " + e.getMessage());
                if (e instanceof InvocationTargetException) {
                    ((InvocationTargetException) e).getTargetException().printStackTrace();
                }
            }

            // 2. Try through ServiceManager / ISurfaceComposer
            System.out.println("\n=== Try ServiceManager approach ===");
            try {
                Class<?> SM = Class.forName("android.os.ServiceManager");
                Method getService = SM.getDeclaredMethod("getService", String.class);
                getService.setAccessible(true);
                Object sfBinder = getService.invoke(null, "SurfaceFlinger");
                System.out.println("  SurfaceFlinger service binder: " + sfBinder);
                if (sfBinder != null) {
                    System.out.println("  Class: " + sfBinder.getClass().getName());
                }
            } catch (Exception e) {
                System.out.println("  Error: " + e.getMessage());
            }

            // 3. Look for all native methods that might give us IDs/tokens
            System.out.println("\n=== Native methods with 'display' or 'Display' ===");
            for (Method m : SC.getDeclaredMethods()) {
                String name = m.getName();
                if (name.startsWith("native") && (name.toLowerCase().contains("display") || 
                    name.toLowerCase().contains("physical"))) {
                    System.out.println("  " + name + "(" +
                        java.util.Arrays.toString(m.getParameterTypes()) + ") -> " +
                        m.getReturnType().getSimpleName());
                }
            }

            // 4. Try calling native methods to get display IDs
            System.out.println("\n=== Try nativeGetDisplayIds ===");
            for (String mName : new String[]{"nativeGetPhysicalDisplayIds", "nativeGetDisplayIds",
                    "nativeGetPhysicalDisplayId", "getPhysicalDisplayId",
                    "nativeGetInternalDisplayToken", "getInternalDisplayToken",
                    "nativeGetPrimaryDisplay", "getPrimaryDisplayToken"}) {
                try {
                    Method m = SC.getDeclaredMethod(mName);
                    m.setAccessible(true);
                    Object result = m.invoke(null);
                    System.out.println("  " + mName + " = " + result);
                } catch (NoSuchMethodException e) {
                    // skip
                } catch (Exception e) {
                    System.out.println("  " + mName + " error: " + e.getMessage());
                }
            }

            // 5. DisplayManagerGlobal - get display IDs
            System.out.println("\n=== DisplayManagerGlobal.getDisplayIds() ===");
            try {
                Class<?> DMG = Class.forName("android.hardware.display.DisplayManagerGlobal");
                Method getInstance = DMG.getDeclaredMethod("getInstance");
                getInstance.setAccessible(true);
                Object dmg = getInstance.invoke(null);
                
                Method getIds = DMG.getDeclaredMethod("getDisplayIds");
                getIds.setAccessible(true);
                int[] displayIds = (int[]) getIds.invoke(dmg);
                System.out.println("  Display IDs: " + java.util.Arrays.toString(displayIds));

                // Get display info for each
                Method getInfo = DMG.getDeclaredMethod("getDisplayInfo", int.class);
                getInfo.setAccessible(true);
                for (int did : displayIds) {
                    Object di = getInfo.invoke(dmg, did);
                    if (di != null) {
                        Class<?> DI = di.getClass();
                        System.out.println("  Display " + did + ":");
                        for (String fn : new String[]{"displayId", "layerStack", "type", "address",
                                "uniqueId", "name", "appWidth", "appHeight", "modeId",
                                "defaultModeId", "physicalDisplayId"}) {
                            try {
                                Field f = DI.getDeclaredField(fn);
                                f.setAccessible(true);
                                System.out.println("    " + fn + " = " + f.get(di));
                            } catch (NoSuchFieldException e) {}
                        }
                        // supportedModes
                        try {
                            Field modesF = DI.getDeclaredField("supportedModes");
                            modesF.setAccessible(true);
                            Object[] modes = (Object[]) modesF.get(di);
                            if (modes != null) {
                                System.out.println("    supportedModes: " + modes.length + " modes");
                                for (Object mode : modes) {
                                    System.out.println("      " + mode);
                                }
                            }
                        } catch (Exception e) {}
                    }
                }
            } catch (Exception e) {
                System.out.println("  Error: " + e.getMessage());
                e.printStackTrace(System.err);
            }

            // 6. Try to get token from display address
            System.out.println("\n=== Try getPhysicalDisplayToken with known IDs ===");
            for (long testId : new long[]{0L, 1L, 4619827677550801152L, 4619827677550801153L}) {
                try {
                    Method m = SC.getDeclaredMethod("getPhysicalDisplayToken", long.class);
                    m.setAccessible(true);
                    Object token = m.invoke(null, testId);
                    System.out.println("  getPhysicalDisplayToken(" + testId + ") = " + token);
                } catch (NoSuchMethodException e) {
                    System.out.println("  getPhysicalDisplayToken method not found");
                    break;
                } catch (Exception e) {
                    System.out.println("  getPhysicalDisplayToken(" + testId + ") error: " + e.getMessage());
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
