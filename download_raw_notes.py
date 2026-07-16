import os
import paramiko

NOTES = [
    ("Bread", "3020946c-2b6e-4e75-bd74-c21a771c7ff3"),
    ("Desserts", "bfb3b004-5f4c-43cb-8a55-303b09e3375b"),
    ("flour tortillas", "8e886dde-daa1-455d-9bba-3b13c0140d83"),
    ("Lemon honey chicken", "9a698575-ff39-4ec3-a0eb-51f28cba9676"),
    ("pickled red onions", "6479e1ce-c40d-4793-9837-634f2c760b60"),
    ("quick notes", "c67dbf43-7d79-4bdc-a974-f884b277b1a5"),
    ("Recipes_handwritten", "7ac49822-7ce4-4fa4-b516-b79b356d0477")
]

def main():
    host = "10.11.99.1"
    password = "an1Or9gwD8"
    remote_base = "/home/root/.local/share/remarkable/xochitl"
    local_base = "raw_handwritten_notes"
    os.makedirs(local_base, exist_ok=True)

    print("=== Downloading Raw Notebook Files via SFTP ===")
    
    # Establish SSH / SFTP connection
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username="root", password=password, timeout=10)
        sftp = ssh.open_sftp()
        print("Connected via SFTP!")
    except Exception as e:
        print(f"Error: Failed to connect to tablet: {e}")
        return

    try:
        for name, guid in NOTES:
            print(f"\nProcessing notebook '{name}' ({guid})...")
            # Files to download: metadata, content, pagedata
            extensions = [".metadata", ".content", ".pagedata"]
            for ext in extensions:
                remote_file = f"{remote_base}/{guid}{ext}"
                local_file = os.path.join(local_base, f"{guid}{ext}")
                try:
                    sftp.stat(remote_file)
                    sftp.get(remote_file, local_file)
                    print(f"  Downloaded: {guid}{ext}")
                except IOError:
                    # File does not exist, which is fine for optional files like .pagedata
                    pass

            # Directory containing page files
            remote_dir = f"{remote_base}/{guid}"
            local_dir = os.path.join(local_base, guid)
            try:
                # Check if remote directory exists
                sftp.stat(remote_dir)
                os.makedirs(local_dir, exist_ok=True)
                
                # List files in remote directory
                remote_files = sftp.listdir(remote_dir)
                print(f"  Found {len(remote_files)} files in folder. Downloading...")
                for f_name in remote_files:
                    r_file = f"{remote_dir}/{f_name}"
                    l_file = os.path.join(local_dir, f_name)
                    sftp.get(r_file, l_file)
                print(f"  Downloaded folder: {guid}/")
            except IOError:
                print(f"  Warning: No page directory found for {guid}")
            except Exception as e:
                print(f"  Error downloading folder: {e}")

        print("\nAll downloads complete!")
    finally:
        sftp.close()
        ssh.close()

if __name__ == "__main__":
    main()
