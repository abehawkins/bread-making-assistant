import os
import json
import subprocess
from reportlab.pdfgen import canvas
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

NOTES = [
    ("Bread", "3020946c-2b6e-4e75-bd74-c21a771c7ff3"),
    ("Desserts", "bfb3b004-5f4c-43cb-8a55-303b09e3375b"),
    ("flour tortillas", "8e886dde-daa1-455d-9bba-3b13c0140d83"),
    ("Lemon honey chicken", "9a698575-ff39-4ec3-a0eb-51f28cba9676"),
    ("pickled red onions", "6479e1ce-c40d-4793-9837-634f2c760b60"),
    ("quick notes", "c67dbf43-7d79-4bdc-a974-f884b277b1a5"),
    ("Recipes_handwritten", "7ac49822-7ce4-4fa4-b516-b79b356d0477")
]

RMC_PATH = r"C:\Users\abeha\AppData\Roaming\Python\Python314\Scripts\rmc.exe"
RAW_DIR = "raw_handwritten_notes"
OUT_DIR = "converted_notes"

def compile_svgs_to_pdf(svg_paths, output_pdf):
    c = canvas.Canvas(output_pdf)
    for svg_path in svg_paths:
        try:
            drawing = svg2rlg(svg_path)
            w, h = drawing.width, drawing.height
            c.setPageSize((w, h))
            renderPDF.draw(drawing, c, 0, 0)
            c.showPage()
        except Exception as e:
            print(f"    Error rendering SVG {svg_path}: {e}")
    c.save()

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("=== Converting Handwritten Notes to PDF ===")
    
    for name, guid in NOTES:
        print(f"\nProcessing '{name}' ({guid})...")
        
        # Load content file
        content_path = os.path.join(RAW_DIR, f"{guid}.content")
        if not os.path.exists(content_path):
            print(f"  Error: Content file not found at {content_path}")
            continue
            
        with open(content_path, "r") as f:
            content = json.load(f)
            
        # Extract page IDs in order
        page_ids = []
        cpages = content.get("cPages")
        if cpages and "pages" in cpages:
            for p in cpages["pages"]:
                # Filter out deleted pages
                if not p.get("deleted"):
                    page_ids.append(p["id"])
        elif "pages" in content:
            # Fallback to older format
            page_ids = content["pages"]
            
        if not page_ids:
            print("  No active pages found in notebook.")
            continue
            
        print(f"  Found {len(page_ids)} active page(s). Converting to SVG...")
        
        svg_paths = []
        temp_files = []
        for idx, page_id in enumerate(page_ids, start=1):
            rm_path = os.path.join(RAW_DIR, guid, f"{page_id}.rm")
            if not os.path.exists(rm_path):
                print(f"    Warning: Stroke file not found for page {idx} ({page_id})")
                continue
                
            temp_svg = os.path.join(RAW_DIR, guid, f"temp_{page_id}.svg")
            cmd = [RMC_PATH, "-t", "svg", rm_path, "-o", temp_svg]
            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                svg_paths.append(temp_svg)
                temp_files.append(temp_svg)
            except Exception as e:
                print(f"    Error converting page {idx} to SVG: {e}")
                
        if not svg_paths:
            print("  Error: No pages were successfully converted to SVG.")
            continue
            
        output_pdf = os.path.join(OUT_DIR, f"{name}.pdf")
        print(f"  Stitching {len(svg_paths)} page(s) into PDF: {output_pdf}...")
        try:
            compile_svgs_to_pdf(svg_paths, output_pdf)
            print(f"  SUCCESS! Converted '{name}' to {output_pdf}")
        except Exception as e:
            print(f"  Error building PDF: {e}")
            
        # Clean up temporary SVG files
        for f in temp_files:
            try:
                os.remove(f)
            except:
                pass
                
    print("\nAll conversions finished!")

if __name__ == "__main__":
    main()
