"""import socket
import hmac
import hashlib
import time

# This MUST match the key on the Ubuntu machine
SECRET_KEY = b"super_secret_lab_key_123"
PORT = 50000

# Set up a UDP socket capable of broadcasting
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
sock.settimeout(5) # Wait 5 seconds for a reply

# Create the payload: Current Timestamp + HMAC Signature
msg = str(int(time.time())).encode()
signature = hmac.new(SECRET_KEY, msg, hashlib.sha256).hexdigest().encode()
payload = msg + b"|" + signature

print("Broadcasting secure discovery ping...")

# Send to the universal broadcast address
sock.sendto(payload, ('255.255.255.255', PORT))

try:
    # Listen for the Ubuntu machine's reply
    data, addr = sock.recvfrom(1024)
    print("\n✅ SUCCESS!")
    print(f"Lab Machine is at IP: {addr[0]}")
    print(f"SSH Command: ssh admin-account@{addr[0]}\n")
except socket.timeout:
    print("\n❌ No response. The machine might be off, or the lab network blocks UDP broadcasts.\n")
"""


import socket
import hmac
import hashlib
import time

# This MUST match the key on the Ubuntu machine
SECRET_KEY = b"super_secret_lab_key_123"
PORT = 50000

def get_local_ip():
    """Tricks the OS into revealing the Mac's actual active Wi-Fi IP address."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Doesn't need to be reachable, just forces the OS to route
        s.connect(('10.255.255.255', 1)) 
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def main():
    mac_ip = get_local_ip()
    print(f"Your Mac's IP Address: {mac_ip}")
    
    if mac_ip == '127.0.0.1':
        print("Error: You do not appear to be connected to the Wi-Fi.")
        return

    # Extract the first three blocks (e.g., '10.34.15')
    ip_parts = mac_ip.split('.')
    base_ip = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}"

    # Set up the UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # We don't need SO_BROADCAST anymore because we are sending direct messages
    sock.settimeout(5) # Wait 5 seconds total for a reply

    # Create the secure payload
    msg = str(int(time.time())).encode()
    signature = hmac.new(SECRET_KEY, msg, hashlib.sha256).hexdigest().encode()
    payload = msg + b"|" + signature

    print(f"Sweeping subnet {base_ip}.x ...")

    # Phase 1: The Blast
    # Fire the payload at every single IP in the subnet instantly
    for i in range(1, 255):
        target_ip = f"{base_ip}.{i}"
        try:
            sock.sendto(payload, (target_ip, PORT))
        except OSError:
            # Ignore OS errors for unreachable network segments
            pass

    # Phase 2: The Listen
    try:
        data, addr = sock.recvfrom(1024)
        print("\n✅ SUCCESS!")
        print(f"Lab Machine is at IP: {addr[0]}")
        print(f"SSH Command: ssh admin-account@{addr[0]}\n")
    except socket.timeout:
        print("\n❌ No response.")
        print("The machine might be off, or it is on a completely different Wi-Fi VLAN.")

if __name__ == "__main__":
    main()