#!/usr/bin/env python3
"""
send_to_remarkable.py

Fetches recipes from the local app configuration and Supabase synced library,
renders them into kitchen-friendly PDFs using reportlab, and uploads them
directly to the reMarkable 2 tablet via its USB web interface API.

Usage:
  python send_to_remarkable.py            # Starts interactive menu
  python send_to_remarkable.py bagels     # Sends a specific recipe by ID
  python send_to_remarkable.py --all      # Sends all recipes
  python send_to_remarkable.py --list     # Lists all recipe IDs
"""

import sys
import os
import requests
import json
import argparse
from pathlib import Path
import socket
import threading
import select
import paramiko

# Add SCRIPT_DIR to sys.path so we can import make_kitchen_pdfs
SCRIPT_DIR = Path(__file__).resolve().parent
ASSISTANT_DIR = SCRIPT_DIR
sys.path.append(str(ASSISTANT_DIR))

try:
    import make_kitchen_pdfs
except ImportError:
    print("Error: Could not import make_kitchen_pdfs.py.")
    sys.exit(1)

SUPABASE_URL = "https://bwybbjlxdqtsebhtpphy.supabase.co"
SUPABASE_KEY = "sb_publishable_k4XhnjoxFVab8_CTuK9iKA_0m6otI11"

def load_local_recipes():
    data_dir = ASSISTANT_DIR / "data"
    recipes = {}
    if not data_dir.is_dir():
        return recipes
    
    for path in data_dir.glob("*.json"):
        if path.name.lower() == "index.json":
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                r = json.load(f)
                if r and "id" in r:
                    recipes[r["id"]] = r
                else:
                    r["id"] = path.stem
                    recipes[path.stem] = r
        except Exception as e:
            print(f"Warning: Failed to load local recipe {path.name}: {e}")
    return recipes

def load_supabase_recipes():
    recipes = {}
    url = f"{SUPABASE_URL}/rest/v1/recipes?select=data&order=updated_at.desc"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    try:
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            for item in res.json():
                r = item.get("data")
                if r and "id" in r:
                    recipes[r["id"]] = r
        else:
            print(f"Note: Supabase returned status code {res.status_code}")
    except Exception as e:
        print(f"Note: Could not connect to Supabase to fetch custom recipes: {e}")
    return recipes

def get_combined_recipes():
    # Load local built-in recipes
    recipes = load_local_recipes()
    # Overwrite/extend with Supabase custom/imported recipes
    custom = load_supabase_recipes()
    recipes.update(custom)
    return recipes

def check_remarkable_connection(host):
    url = f"http://{host}/"
    try:
        res = requests.get(url, timeout=2)
        return True
    except requests.RequestException:
        return False

def start_ssh_tunnel(wifi_ip, ssh_password, local_port=8080):
    print(f"Opening secure SSH tunnel to WiFi IP {wifi_ip}...", end="", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(wifi_ip, username="root", password=ssh_password, timeout=10)
        print(" SSH Connected!")
        # Bind the USB interface IP to the loopback interface on the tablet so the web server is reachable internally
        ssh.exec_command("/sbin/ip addr add 10.11.99.1/32 dev lo 2>/dev/null || true")
    except Exception as e:
        print(f" Failed: {e}")
        return None, None
        
    transport = ssh.get_transport()
    
    def handler_run(chan, sock):
        while True:
            try:
                r, w, x = select.select([sock, chan], [], [], 1.0)
                if sock in r:
                    data = sock.recv(4096)
                    if len(data) == 0:
                        break
                    chan.send(data)
                if chan in r:
                    data = chan.recv(4096)
                    if len(data) == 0:
                        break
                    sock.send(data)
            except Exception:
                break
        chan.close()
        sock.close()
        
    def tunnel_server(port, transport):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            server.bind(('127.0.0.1', port))
            server.listen(5)
        except Exception as e:
            print(f"\nTunnel failed to bind to local port {port}: {e}")
            return
            
        server.settimeout(0.5)
        while transport.is_active():
            try:
                sock, addr = server.accept()
            except socket.timeout:
                continue
            except Exception:
                break
                
            chan = transport.open_channel('direct-tcpip', ('10.11.99.1', 80), addr)
            if chan is None:
                sock.close()
                continue
                
            t = threading.Thread(target=handler_run, args=(chan, sock))
            t.daemon = True
            t.start()
        server.close()
        
    tunnel_thread = threading.Thread(target=tunnel_server, args=(local_port, transport))
    tunnel_thread.daemon = True
    tunnel_thread.start()
    
    return ssh, local_port

def find_recipes_folder(host):
    url = f"http://{host}/documents/"
    try:
        res = requests.get(url, timeout=5)
        if res.status_code == 200:
            items = res.json()
            if isinstance(items, dict):
                for uuid, item in items.items():
                    name = item.get("VissibleName") or item.get("VisibleName") or ""
                    item_type = item.get("Type") or ""
                    if name.lower() == "recipes" and item_type == "CollectionType":
                        return uuid
            elif isinstance(items, list):
                for item in items:
                    name = item.get("VissibleName") or item.get("VisibleName") or ""
                    item_type = item.get("Type") or ""
                    if name.lower() == "recipes" and item_type == "CollectionType":
                        return item.get("ID")
    except Exception as e:
        print(f"Warning: Failed to scan folders on tablet: {e}")
    return None

def upload_pdf_to_remarkable(host, pdf_path, folder_uuid=None):
    # Stateful API: first GET the directory context to set the active directory on the tablet
    context_url = f"http://{host}/documents/{folder_uuid}" if folder_uuid else f"http://{host}/documents/"
    try:
        requests.get(context_url, timeout=5)
    except Exception as e:
        print(f" WARNING (Could not set directory context: {e})", end="", flush=True)
        
    upload_url = f"http://{host}/upload"
    print(f"Uploading {pdf_path.name} to tablet...", end="", flush=True)
    try:
        with open(pdf_path, "rb") as f:
            files = {"file": (pdf_path.name, f, "application/pdf")}
            res = requests.post(upload_url, files=files, timeout=30)
            if res.status_code in (200, 201):
                print(" SUCCESS!")
                return True
            else:
                print(f" FAILED! (Status code: {res.status_code})")
                print(f"Response: {res.text}")
                return False
    except Exception as e:
        print(f" FAILED! (Error: {e})")
        return False

def process_recipe(recipe, host, folder_uuid, upload=True):
    recipe_id = recipe.get("id")
    recipe_name = recipe.get("name", "Untitled")
    out_dir = ASSISTANT_DIR / "kitchen-pdfs"
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / f"{recipe_id}.pdf"
    
    print(f"Generating PDF for '{recipe_name}'...")
    try:
        make_kitchen_pdfs.render_recipe_pdf(recipe, pdf_path)
    except Exception as e:
        print(f"Error rendering PDF for {recipe_name}: {e}")
        return False
        
    if upload:
        return upload_pdf_to_remarkable(host, pdf_path, folder_uuid)
    else:
        print(f"  Saved PDF locally to: {pdf_path.relative_to(SCRIPT_DIR)}")
        return True

def main():
    parser = argparse.ArgumentParser(description="Send Recipe Assistant recipes to reMarkable 2")
    parser.add_argument("recipe_id", nargs="?", help="ID of the recipe to send (e.g. bagels)")
    parser.add_argument("--all", action="store_true", help="Send all recipes")
    parser.add_argument("--list", action="store_true", help="List all available recipes and exit")
    parser.add_argument("--host", default="10.11.99.1", help="reMarkable 2 USB IP address (default: 10.11.99.1)")
    args = parser.parse_args()
    
    print("=== Recipe Assistant -> reMarkable 2 Uploader ===")
    print("Loading recipes...")
    recipes = get_combined_recipes()
    if not recipes:
        print("Error: No recipes found in local data folder or Supabase!")
        sys.exit(1)
        
    if args.list:
        print(f"\nAvailable Recipes ({len(recipes)} total):")
        for rid, r in sorted(recipes.items(), key=lambda x: x[1].get("name", "").lower()):
            print(f"  - {rid:<25} ({r.get('name')})")
        sys.exit(0)
        
    # Check tablet connection
    print(f"Connecting to tablet at http://{args.host}...")
    connected = check_remarkable_connection(args.host)
    ssh_client = None
    folder_uuid = None
    
    if not connected and args.host == "10.11.99.1":
        config_path = SCRIPT_DIR / "remarkable_config.json"
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                wifi_ip = cfg.get("wifi_ip")
                ssh_pass = cfg.get("ssh_password")
                if wifi_ip and ssh_pass:
                    print("USB not connected. Attempting WiFi SSH tunnel fallback...")
                    ssh_client, tunnel_port = start_ssh_tunnel(wifi_ip, ssh_pass)
                    if ssh_client:
                        args.host = f"127.0.0.1:{tunnel_port}"
                        connected = check_remarkable_connection(args.host)
            except Exception as e:
                print(f"Warning: Failed to establish WiFi tunnel: {e}")
                
    if not connected:
        print("\nNOTE: reMarkable 2 is not reachable over USB (10.11.99.1) or WiFi tunnel.")
        print("PDFs will be generated locally in 'kitchen-pdfs/' but cannot be uploaded.")
        print("To enable automatic upload, connect the tablet via USB or ensure the WiFi config is correct.")
        print("Continuing with local PDF generation only...\n")
    else:
        print("Connected to tablet!")
        # Check for Recipes folder
        folder_uuid = find_recipes_folder(args.host)
        if folder_uuid:
            print(f"Found 'Recipes' folder on tablet (UUID: {folder_uuid}). Files will be placed there.")
        else:
            print("Note: 'Recipes' folder not found on tablet. Files will upload to the top level.")
            print("Tip: Create a folder named 'Recipes' on your tablet to organize your cooking files.")
        
    # Decide what to upload
    target_recipes = []
    if args.all:
        target_recipes = list(recipes.values())
    elif args.recipe_id:
        rid = args.recipe_id
        if rid in recipes:
            target_recipes = [recipes[rid]]
        else:
            # Try case-insensitive matching or name matching
            matched = [r for r in recipes.values() if rid.lower() in r.get("id", "").lower() or rid.lower() in r.get("name", "").lower()]
            if len(matched) == 1:
                target_recipes = matched
            elif len(matched) > 1:
                print(f"\nMultiple recipes matched '{rid}':")
                for r in matched:
                    print(f"  - {r.get('id')} ({r.get('name')})")
                sys.exit(1)
            else:
                print(f"Error: Recipe ID '{rid}' not found.")
                print("Use --list to see available recipe IDs.")
                sys.exit(1)
    else:
        # Interactive mode
        sorted_recipes = sorted(recipes.values(), key=lambda x: x.get("name", "").lower())
        print(f"\nAvailable Recipes:")
        for idx, r in enumerate(sorted_recipes, 1):
            print(f" [{idx:2d}] {r.get('name')} ({r.get('id')})")
        print(" [All] Send all recipes")
        print(" [ Q ] Quit")
        
        choice = input("\nSelect a recipe to send [1-N, All, Q]: ").strip()
        if choice.lower() == 'q':
            print("Goodbye.")
            sys.exit(0)
        elif choice.lower() == 'all':
            target_recipes = sorted_recipes
        else:
            try:
                idx = int(choice)
                if 1 <= idx <= len(sorted_recipes):
                    target_recipes = [sorted_recipes[idx - 1]]
                else:
                    print("Invalid selection.")
                    sys.exit(1)
            except ValueError:
                print("Invalid input.")
                sys.exit(1)
                
    # Process recipes
    success_count = 0
    try:
        for r in target_recipes:
            if process_recipe(r, args.host, folder_uuid, upload=connected):
                success_count += 1
    finally:
        if ssh_client:
            print("Closing secure SSH tunnel...")
            ssh_client.close()
            
    if connected:
        print(f"\nDone! Successfully transferred {success_count}/{len(target_recipes)} recipes.")
    else:
        print(f"\nDone! Successfully generated {success_count}/{len(target_recipes)} PDFs locally.")

if __name__ == "__main__":
    main()
