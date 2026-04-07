import java.lang.reflect.*;

public class ProbeAPI5 {
    public static void main(String[] args) {
        try {
            Class<?> SC = Class.forName("android.view.SurfaceControl");
            Class<?> IB = Class.forName("android.os.IBinder");

            // Find ALL methods that return IBinder
            System.out.println("=== Methods returning IBinder ===");
            for (Method m : SC.getDeclaredMethods()) {
                if (IB.isAssignableFrom(m.getReturnType())) {
                    System.out.println("  " + m.getName() + "(" +
                        formatParams(m.getParameterTypes()) + ")");
                }
            }

            // Find ALL native methods
            System.out.println("\n=== ALL native methods ===");
            for (Method m : SC.getDeclaredMethods()) {
                if (Modifier.isNative(m.getModifiers())) {
                    System.out.println("  " + m.getReturnType().getSimpleName() + " " +
                        m.getName() + "(" + formatParams(m.getParameterTypes()) + ")");
                }
            }

            // Try to get display token via SurfaceFlinger binder directly
            System.out.println("\n=== Try SurfaceFlinger binder call ===");
            try {
                Class<?> SM = Class.forName("android.os.ServiceManager");
                Method getService = SM.getDeclaredMethod("getService", String.class);
                getService.setAccessible(true);
                Object sfBinder = getService.invoke(null, "SurfaceFlinger");
                
                // Try to transact with known codes
                // ISurfaceComposer AIDL stable interface - method ordering:
                // In AIDL, methods are alphabetically sorted for stable interfaces
                // Let's use Parcel to call getPhysicalDisplayIds and getPhysicalDisplayToken
                
                Class<?> Parcel = Class.forName("android.os.Parcel");
                Method obtain = Parcel.getDeclaredMethod("obtain");
                
                // First, let's discover the interface descriptor
                Method transact = IB.getDeclaredMethod("transact", int.class, Parcel.getClass(),
                    Parcel.getClass(), int.class);
                
                Object data = obtain.invoke(null);
                Object reply = obtain.invoke(null);
                
                // INTERFACE_TRANSACTION = 0x5f4e5446 (FIRST_CALL_TRANSACTION = 1)
                // Try INTERFACE_TRANSACTION to get the interface name
                Method writeInterfaceToken = Parcel.getDeclaredMethod("writeInterfaceToken", String.class);
                Method readString = Parcel.getDeclaredMethod("readString");
                Method readException = Parcel.getDeclaredMethod("readException");
                Method readInt = Parcel.getDeclaredMethod("readInt");
                Method readLong = Parcel.getDeclaredMethod("readLong");
                Method readStrongBinder = Parcel.getDeclaredMethod("readStrongBinder");
                Method recycle = Parcel.getDeclaredMethod("recycle");
                Method setDataPosition = Parcel.getDeclaredMethod("setDataPosition", int.class);
                
                // First just get descriptor
                boolean r = (boolean) transact.invoke(sfBinder, 0x5f4e5446, data, reply, 0);
                setDataPosition.invoke(reply, 0);
                String desc = (String) readString.invoke(reply);
                System.out.println("  Descriptor: " + desc);
                recycle.invoke(data);
                recycle.invoke(reply);
                
            } catch (Exception e) {
                System.out.println("  Error: " + e);
                e.printStackTrace(System.err);
            }

            // Check SurfaceControl.Transaction for display-related methods
            System.out.println("\n=== SurfaceControl.Transaction display methods ===");
            try {
                Class<?> Trans = Class.forName("android.view.SurfaceControl$Transaction");
                for (Method m : Trans.getDeclaredMethods()) {
                    String name = m.getName().toLowerCase();
                    if (name.contains("display") || name.contains("mode")) {
                        System.out.println("  " + m.getName() + "(" +
                            formatParams(m.getParameterTypes()) + ")");
                    }
                }
            } catch (Exception e) {}

            // Look for DisplayControl in SurfaceControl
            System.out.println("\n=== Check for display token in DynamicDisplayInfo ===");
            try {
                Method m = SC.getDeclaredMethod("getDynamicDisplayInfo", long.class);
                m.setAccessible(true);
                Object info = m.invoke(null, 4627039422300187648L);
                if (info != null) {
                    Class<?> DDI = info.getClass();
                    System.out.println("  Fields in DynamicDisplayInfo:");
                    for (Field f : DDI.getDeclaredFields()) {
                        f.setAccessible(true);
                        System.out.println("    " + f.getType().getSimpleName() + " " + f.getName() + " = " + f.get(info));
                    }
                }
            } catch (Exception e) {
                System.out.println("  Error: " + e);
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
