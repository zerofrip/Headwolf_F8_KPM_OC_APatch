import java.lang.reflect.*;

public class ProbeAPI {
    public static void main(String[] args) {
        try {
            Class<?> SC = Class.forName("android.view.SurfaceControl");
            System.out.println("=== SurfaceControl methods (display-related) ===");
            for (Method m : SC.getDeclaredMethods()) {
                String name = m.getName().toLowerCase();
                if (name.contains("display") || name.contains("physical") || 
                    name.contains("mode") || name.contains("refresh") ||
                    name.contains("token")) {
                    m.setAccessible(true);
                    StringBuilder sb = new StringBuilder();
                    sb.append(Modifier.isStatic(m.getModifiers()) ? "static " : "");
                    sb.append(m.getReturnType().getSimpleName()).append(" ");
                    sb.append(m.getName()).append("(");
                    Class<?>[] params = m.getParameterTypes();
                    for (int i = 0; i < params.length; i++) {
                        if (i > 0) sb.append(", ");
                        sb.append(params[i].getSimpleName());
                    }
                    sb.append(")");
                    System.out.println("  " + sb);
                }
            }

            // Check inner classes
            System.out.println("\n=== SurfaceControl inner classes ===");
            for (Class<?> c : SC.getDeclaredClasses()) {
                System.out.println("  " + c.getSimpleName());
            }

            // Check for DisplayControl class
            try {
                Class<?> DC = Class.forName("android.view.SurfaceControl$DisplayControl");
                System.out.println("\n=== DisplayControl methods ===");
                for (Method m : DC.getDeclaredMethods()) {
                    m.setAccessible(true);
                    StringBuilder sb = new StringBuilder();
                    sb.append(Modifier.isStatic(m.getModifiers()) ? "static " : "");
                    sb.append(m.getReturnType().getSimpleName()).append(" ");
                    sb.append(m.getName()).append("(");
                    Class<?>[] params = m.getParameterTypes();
                    for (int i = 0; i < params.length; i++) {
                        if (i > 0) sb.append(", ");
                        sb.append(params[i].getSimpleName());
                    }
                    sb.append(")");
                    System.out.println("  " + sb);
                }
            } catch (ClassNotFoundException e) {
                System.out.println("No DisplayControl inner class");
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
