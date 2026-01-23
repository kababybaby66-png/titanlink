using System;
using System.Threading;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

/*
 * vigem-feeder.exe - Virtual Xbox 360 Controller Feeder
 * 
 * This helper application creates a virtual Xbox 360 controller via ViGEmBus
 * and reads input data from stdin to update the controller state.
 * 
 * Input format (one line per update):
 * buttons,leftTrigger,rightTrigger,thumbLX,thumbLY,thumbRX,thumbRY
 * 
 * Where:
 * - buttons: 16-bit button flags (same as XINPUT_GAMEPAD)
 * - leftTrigger/rightTrigger: 0-255
 * - thumbLX/LY/RX/RY: -32768 to 32767
 * 
 * Commands:
 * - QUIT: Disconnect controller and exit
 */

class Program
{
    static void Main(string[] args)
    {
        ViGEmClient? client = null;
        IXbox360Controller? controller = null;
        
        try
        {
            Console.Error.WriteLine("DEBUG: Attempting to connect to ViGEmBus...");
            Console.Error.Flush();
            
            // Connect to ViGEmBus driver
            try
            {
                client = new ViGEmClient();
                Console.Error.WriteLine("DEBUG: ViGEmClient created successfully");
                Console.Error.Flush();
            }
            catch (Nefarius.ViGEm.Client.Exceptions.VigemBusNotFoundException ex)
            {
                Console.Error.WriteLine($"ERROR: ViGEmBus driver not found. Please install ViGEmBus.");
                Console.Error.WriteLine($"Details: {ex.Message}");
                Environment.Exit(2);
                return;
            }
            catch (Nefarius.ViGEm.Client.Exceptions.VigemBusAccessFailedException ex)
            {
                Console.Error.WriteLine($"ERROR: Access to ViGEmBus denied. Try running as administrator.");
                Console.Error.WriteLine($"Details: {ex.Message}");
                Environment.Exit(3);
                return;
            }
            catch (Nefarius.ViGEm.Client.Exceptions.VigemBusVersionMismatchException ex)
            {
                Console.Error.WriteLine($"ERROR: ViGEmBus version mismatch. Please update ViGEmBus driver.");
                Console.Error.WriteLine($"Details: {ex.Message}");
                Environment.Exit(4);
                return;
            }
            
            // Create virtual Xbox 360 controller
            controller = client.CreateXbox360Controller();
            controller.Connect();
            
            Console.WriteLine("CONNECTED");
            Console.Out.Flush();
            
            // Read input from stdin
            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                
                if (string.IsNullOrEmpty(line))
                    continue;
                    
                if (line == "QUIT")
                {
                    break;
                }
                
                try
                {
                    // Parse input: buttons,LT,RT,LX,LY,RX,RY
                    var parts = line.Split(',');
                    if (parts.Length != 7)
                        continue;
                    
                    ushort buttons = ushort.Parse(parts[0]);
                    byte leftTrigger = byte.Parse(parts[1]);
                    byte rightTrigger = byte.Parse(parts[2]);
                    short thumbLX = short.Parse(parts[3]);
                    short thumbLY = short.Parse(parts[4]);
                    short thumbRX = short.Parse(parts[5]);
                    short thumbRY = short.Parse(parts[6]);
                    
                    // Update controller state
                    controller.SetButtonState(Xbox360Button.Up, (buttons & 0x0001) != 0);
                    controller.SetButtonState(Xbox360Button.Down, (buttons & 0x0002) != 0);
                    controller.SetButtonState(Xbox360Button.Left, (buttons & 0x0004) != 0);
                    controller.SetButtonState(Xbox360Button.Right, (buttons & 0x0008) != 0);
                    controller.SetButtonState(Xbox360Button.Start, (buttons & 0x0010) != 0);
                    controller.SetButtonState(Xbox360Button.Back, (buttons & 0x0020) != 0);
                    controller.SetButtonState(Xbox360Button.LeftThumb, (buttons & 0x0040) != 0);
                    controller.SetButtonState(Xbox360Button.RightThumb, (buttons & 0x0080) != 0);
                    controller.SetButtonState(Xbox360Button.LeftShoulder, (buttons & 0x0100) != 0);
                    controller.SetButtonState(Xbox360Button.RightShoulder, (buttons & 0x0200) != 0);
                    controller.SetButtonState(Xbox360Button.Guide, (buttons & 0x0400) != 0);
                    controller.SetButtonState(Xbox360Button.A, (buttons & 0x1000) != 0);
                    controller.SetButtonState(Xbox360Button.B, (buttons & 0x2000) != 0);
                    controller.SetButtonState(Xbox360Button.X, (buttons & 0x4000) != 0);
                    controller.SetButtonState(Xbox360Button.Y, (buttons & 0x8000) != 0);
                    
                    controller.SetSliderValue(Xbox360Slider.LeftTrigger, leftTrigger);
                    controller.SetSliderValue(Xbox360Slider.RightTrigger, rightTrigger);
                    
                    controller.SetAxisValue(Xbox360Axis.LeftThumbX, thumbLX);
                    controller.SetAxisValue(Xbox360Axis.LeftThumbY, thumbLY);
                    controller.SetAxisValue(Xbox360Axis.RightThumbX, thumbRX);
                    controller.SetAxisValue(Xbox360Axis.RightThumbY, thumbRY);
                    
                    controller.SubmitReport();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Parse error: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ERROR: {ex.GetType().Name}: {ex.Message}");
            if (ex.InnerException != null)
            {
                Console.Error.WriteLine($"INNER: {ex.InnerException.GetType().Name}: {ex.InnerException.Message}");
            }
            Console.Error.WriteLine($"Stack: {ex.StackTrace}");
            Console.Error.WriteLine("Make sure ViGEmBus driver is installed.");
            Environment.Exit(1);
        }
        finally
        {
            // Cleanup
            controller?.Disconnect();
            client?.Dispose();
        }
        
        Console.WriteLine("DISCONNECTED");
    }
}
