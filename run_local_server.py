import http.server
import socketserver
import json
import urllib.parse
import sys
import socket
from pathlib import Path

# Add workspace directory to path so we can import our uploader module
WORKSPACE_DIR = Path(__file__).resolve().parent
sys.path.append(str(WORKSPACE_DIR))

import send_to_remarkable

PORT = 8000

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.254.254.254', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class RecipeAppHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve from the root of this directory
        static_dir = WORKSPACE_DIR
        super().__init__(*args, directory=str(static_dir), **kwargs)

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/api/send":
            query_params = urllib.parse.parse_qs(parsed_url.query)
            recipe_id = query_params.get("recipeId", [None])[0]
            
            if not recipe_id:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing recipeId parameter")
                return
                
            print(f"\n[Server] Request received: Send recipe '{recipe_id}' to tablet...")
            
            try:
                # Load recipe database
                recipes = send_to_remarkable.get_combined_recipes()
                if recipe_id not in recipes:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(f"Recipe '{recipe_id}' not found".encode())
                    return
                    
                recipe = recipes[recipe_id]
                
                # Check connection (try USB first, then fallback to WiFi SSH tunnel)
                host = "10.11.99.1"
                connected = send_to_remarkable.check_remarkable_connection(host)
                ssh_client = None
                tunnel_port = None
                
                if not connected:
                    config_path = WORKSPACE_DIR / "remarkable_config.json"
                    if config_path.exists():
                        with open(config_path, "r") as f:
                            cfg = json.load(f)
                        wifi_ip = cfg.get("wifi_ip")
                        ssh_pass = cfg.get("ssh_password")
                        if wifi_ip and ssh_pass:
                            print("USB connection not detected. Establishing WiFi SSH tunnel...")
                            ssh_client, tunnel_port = send_to_remarkable.start_ssh_tunnel(wifi_ip, ssh_pass)
                            if ssh_client:
                                host = f"127.0.0.1:{tunnel_port}"
                                connected = send_to_remarkable.check_remarkable_connection(host)
                                
                if not connected:
                    print("Error: Tablet not reachable over USB or WiFi.")
                    self.send_response(503)
                    self.end_headers()
                    self.wfile.write(b"reMarkable tablet not reachable.")
                    return
                    
                # Find Recipes folder UUID
                folder_uuid = send_to_remarkable.find_recipes_folder(host)
                
                # Process and upload recipe
                success = send_to_remarkable.process_recipe(recipe, host, folder_uuid, upload=True)
                
                # Clean up tunnel
                if ssh_client:
                    print("Closing WiFi SSH tunnel...")
                    ssh_client.close()
                    
                if success:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    response_data = {
                        "status": "success",
                        "message": f"Recipe '{recipe.get('name')}' sent to tablet!"
                    }
                    self.wfile.write(json.dumps(response_data).encode())
                else:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(b"Failed to compile or upload recipe.")
            except Exception as e:
                print(f"Error processing upload: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Server error: {e}".encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

def run():
    # Use ThreadingTCPServer to handle concurrent requests (e.g. static assets + API calls)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), RecipeAppHandler) as httpd:
        local_ip = get_local_ip()
        print("==================================================")
        print("Recipe Assistant Local Server Started!")
        print("==================================================")
        print(f" PC Browser URL:   http://localhost:{PORT}")
        print(f" Mobile/Phone URL:  http://{local_ip}:{PORT}")
        print("--------------------------------------------------")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    run()
