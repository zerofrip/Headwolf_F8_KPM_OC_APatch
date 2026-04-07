import java.lang.reflect.*;

public class ProbeAPI2 {
    public static void main(String[] args) {
        try {
            Class<?> SC = Class.forName("android.view.SurfaceControl");
            
            // Show ALL methods that might help get display IDs or tokens
            System.out.println("=== ALL SurfaceControl methods ===");
            for (Method m : SC.getDeclaredMethods()) {
                String name = m.getName();
                // Skip nest access methods  
                if (name.startsWith("-$$Nest")) continue;
                if (name.startsWith("native")) continue;
                m.setAccessible(true);
                StringBuilder sb = new StringBuilder();
                sb.append(Modifier.isStatic(m.getModifiers()) ? "static " : "");
                sb.append(m.getReturnType().getSimpleName()).append(" ");
                sb.append(name).append("(");
                Class<?>[] params = m.getParameterTypes();
                for (int i = 0; i < params.length; i++) {
                    if (i > 0) sb.append(", ");
                    sb.append(params[i].getSimpleName());
                }
                sb.append(")");
                System.out.println("  " + sb);
            }

            // Try SurfaceControl.getInternalDisplayToken
            System.out.println("\n=== Trying getInternalDisplayToken ===");
            try {
                Method git = SC.getDeclaredMethod("getInternalDisplayToken");
                git.setAccessible(true);
                Object token = git.invoke(null);
                System.out.println("getInternalDisplayToken = " + token);
            } catch (Exception e) {
                System.out.println("Not found: " + e.getMessage());
            }

            // Try getting display IDs from DynamicDisplayInfo
            System.out.println("\n=== Trying getPhysicalDisplayIds via native ===");
            try {
                Method m = SC.getDeclaredMethod("nativeGetPhysicalDisplayIds");
                m.setAccessible(true);
                long[] ids = (long[]) m.invoke(null);
                System.out.println("nativeGetPhysicalDisplayIds = " + java.util.Arrays.toString(ids));
            } catch (Exception e) {
                System.out.println("Not found: " + e.getMessage());
            }

            // Try nativeGetPhysicalDisplayToken
            System.out.println("\n=== Trying nativeGetPhysicalDisplayToken ===");
            try {
                Method m = SC.getDeclaredMethod("nativeGetPhysicalDisplayToken", long.class);
                m.setAccessible(true);
                System.out.println("nativeGetPhysicalDisplayToken exists!");
            } catch (Exception e) {
                System.out.println("Not found: " + e.getMessage());
            }

            // Check DisplayManager or DisplayManagerGlobal
            System.out.println("\n=== Trying DisplayManagerGlobal ===");
            try {
                Class<?> DMG = Class.forName("android.hardware.display.DisplayManagerGlobal");
                for (Method m : DMG.getDeclaredMethods()) {
                    String name = m.getName();
                    if (name.contains("display") || name.contains("Display") || 
                        name.contains("token") || name.contains("Token") ||
                        name.contains("physical") || name.contains("Physical") ||
                        name.contains("Id") || name.contains("id")) {
                        System.out.println("  " + m.getName() + "(" + 
                            java.util.Arrays.toString(m.getParameterTypes()) + ") -> " + 
                            m.getReturnType().getSimpleName());
                    }
                }
            } catch (Exception e) {
                System.out.println("Not found: " + e.getMessage());
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
