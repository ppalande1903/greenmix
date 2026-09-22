"""
Greenmix Clinical Sample Generator
Generates realistic clinical dental cavity images (prepared cavities and post-restoration counterparts)
along with physical ground truth dimensions for system validation and calibration.
"""

import os
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(OUTPUT_DIR, exist_ok=True)

def create_radial_gradient_mask(w, h, center, radii, angle=0):
    """Generates an elliptical depth/intensity profile."""
    y, x = np.ogrid[:h, :w]
    cx, cy = center
    rx, ry = radii
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    
    # Rotated coordinates
    xr = (x - cx) * cos_a + (y - cy) * sin_a
    yr = -(x - cx) * sin_a + (y - cy) * cos_a
    
    dist = (xr / rx)**2 + (yr / ry)**2
    mask = np.clip(1.0 - dist, 0.0, 1.0)
    return mask

def generate_case_1_class_1_molar():
    """
    Mandibular First Molar with Class I Occlusal Cavity.
    Scale: 50 pixels = 1.0 mm (Image size: 800x800, tooth is ~11mm x 10mm -> 550x500 px)
    """
    width, height = 800, 800
    scale_px_per_mm = 50.0  # 1 mm = 50 px
    
    # 1. Background oral cavity / rubber dam (dark blue/purple medical rubber dam)
    base = np.zeros((height, width, 3), dtype=np.float32)
    # Rubber dam texture
    base[:, :] = [32, 54, 85]  # Slate blue dental dam
    
    # Add subtle rubber dam sheen/texture
    noise = np.random.normal(0, 3, (height, width, 3)).astype(np.float32)
    base = np.clip(base + noise, 0, 255)
    
    # 2. Tooth Crown (Enamel base: ivory white/light cream)
    # Mandibular molar shape: rounded trapezoidal / pentagonal occlusal table
    tooth_mask = np.zeros((height, width), dtype=np.float32)
    cy, cx = 400, 400
    y, x = np.ogrid[:height, :width]
    
    # Molar crown outline
    dist_crown = (((x - cx) / 260.0)**4 + ((y - cy) / 230.0)**4)
    tooth_mask = np.clip(1.0 - (dist_crown - 0.45) * 4.0, 0.0, 1.0)
    
    # Enamel color gradient (cusp peaks are lighter, cervical margin slightly warmer)
    enamel_color = np.zeros((height, width, 3), dtype=np.float32)
    enamel_color[:, :] = [238, 232, 218] # A2/A3 enamel ivory
    
    # Cusp shading (buccal & lingual cusps)
    cusp_shading = np.zeros((height, width), dtype=np.float32)
    cusps = [(310, 280), (490, 280), (280, 490), (420, 500), (520, 470)] # 5 cusps of lower molar
    for ccx, ccy in cusps:
        c_dist = np.sqrt((x - ccx)**2 + (y - ccy)**2)
        cusp_shading += np.clip(1.0 - c_dist / 110.0, 0.0, 1.0) * 0.25
        
    enamel_color[:, :, 0] += cusp_shading * 18
    enamel_color[:, :, 1] += cusp_shading * 18
    enamel_color[:, :, 2] += cusp_shading * 15
    
    # Natural developmental grooves
    groove_mask = np.zeros((height, width), dtype=np.float32)
    # central fissure line
    fissure_dist = np.abs(y - (cy + 15 * np.sin((x - cx)/50.0)))
    fissure = np.clip(1.0 - fissure_dist / 3.5, 0.0, 1.0) * (np.abs(x - cx) < 220)
    
    # Blend tooth over rubber dam
    t_mask_3d = np.repeat(tooth_mask[:, :, np.newaxis], 3, axis=2)
    img_tooth = base * (1.0 - t_mask_3d) + enamel_color * t_mask_3d
    
    # 3. Prepared Cavity Geometry (Class I occlusal preparation)
    # Cavity: Central groove extension + mesial/distal pits
    # True dimensions: Length = 6.2 mm (~310 px), Width = 3.4 mm (~170 px), Max Depth = 2.8 mm
    cavity_mask = np.zeros((height, width), dtype=np.float32)
    
    # Main central box
    box1 = np.clip(1.0 - (((x - cx) / 140.0)**2 + ((y - cy) / 75.0)**2), 0.0, 1.0)
    # Mesial dovetail extension
    box2 = np.clip(1.0 - (((x - (cx - 100)) / 55.0)**2 + ((y - (cy - 20)) / 60.0)**2), 0.0, 1.0)
    # Distal dovetail extension
    box3 = np.clip(1.0 - (((x - (cx + 105)) / 55.0)**2 + ((y - (cy + 15)) / 60.0)**2), 0.0, 1.0)
    
    cavity_raw = np.maximum(np.maximum(box1, box2), box3)
    cavity_binary = (cavity_raw > 0.05).astype(np.float32)
    
    # Smooth cavity margin
    from scipy.ndimage import gaussian_filter, distance_transform_edt
    cavity_smooth = gaussian_filter(cavity_binary, sigma=2.0)
    cavity_mask = (cavity_smooth > 0.4).astype(np.float32)
    
    # 4. Cavity Internal Morphology & Depth Map (in mm)
    # Pulpal floor is deep, walls slope inwards slightly (6-degree draft angle)
    dist_from_margin = distance_transform_edt(cavity_mask) # in pixels
    max_dist_px = np.max(dist_from_margin)
    
    # Depth profile: reaches 2.8 mm on pulpal floor
    depth_map_mm = np.zeros((height, width), dtype=np.float32)
    normalized_depth = np.clip(dist_from_margin / (max_dist_px * 0.75), 0.0, 1.0)
    # Smooth floor with anatomical pulpal floor contour
    depth_map_mm = (1.0 - np.exp(-3.0 * normalized_depth)) * 2.8 * cavity_mask
    
    # Color of prepared dentin floor (warm yellow-brown dentin with prepared bur striations)
    dentin_base = np.zeros((height, width, 3), dtype=np.float32)
    dentin_base[:, :] = [178, 140, 88] # Dentin color
    
    # Shadow / depth fall-off (deeper cavity floor receives less direct illumination)
    depth_shadow = 1.0 - 0.45 * (depth_map_mm / 2.8)
    dentin_floor = dentin_base * depth_shadow[:, :, np.newaxis]
    
    # Prepared bevel / cavosurface enamel margin highlight
    margin_edges = np.clip(gaussian_filter(cavity_mask, sigma=1.0) - gaussian_filter(cavity_mask, sigma=3.0), 0, 1)
    
    # Compose pre-op prepared cavity image
    c_mask_3d = np.repeat(cavity_mask[:, :, np.newaxis], 3, axis=2)
    preop_img = img_tooth * (1.0 - c_mask_3d) + dentin_floor * c_mask_3d
    preop_img += margin_edges[:, :, np.newaxis] * 35.0 # Light reflection on enamel bevel
    preop_img = np.clip(preop_img, 0, 255).astype(np.uint8)
    
    # 5. Add 5.0 mm Clinical Calibration Scale Bar (Ruler) in upper-left corner
    pil_preop = Image.fromarray(preop_img)
    draw = ImageDraw.Draw(pil_preop)
    # 5.0 mm = 5.0 * 50 = 250 px
    ruler_x0, ruler_y = 60, 70
    ruler_x1 = ruler_x0 + int(5.0 * scale_px_per_mm)
    
    # White background tag for ruler
    draw.rectangle([ruler_x0 - 15, ruler_y - 25, ruler_x1 + 15, ruler_y + 25], fill=(20, 28, 45, 230))
    draw.line([(ruler_x0, ruler_y), (ruler_x1, ruler_y)], fill=(0, 240, 255), width=4)
    draw.line([(ruler_x0, ruler_y - 8), (ruler_x0, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw.line([(ruler_x1, ruler_y - 8), (ruler_x1, ruler_y + 8)], fill=(0, 240, 255), width=3)
    # Ticks every 1 mm = 50 px
    for i in range(1, 5):
        tx = ruler_x0 + i * int(scale_px_per_mm)
        draw.line([(tx, ruler_y - 4), (tx, ruler_y + 4)], fill=(0, 240, 255), width=2)
        
    draw.text((ruler_x0 + 65, ruler_y - 20), "CALIBRATION: 5.0 mm", fill=(255, 255, 255))
    
    # 6. Generate Post-Restoration Image (Composite Restored & Cured)
    # Composite filled into cavity, polished with anatomical fissures + 0.3mm slight flash margin
    postop_np = np.copy(img_tooth)
    
    # Composite material appearance: translucent resin matching enamel with slight shade boundary
    composite_color = np.zeros((height, width, 3), dtype=np.float32)
    composite_color[:, :] = [232, 226, 212] # Cured nanohybrid shade A2
    
    # Add subtle cured surface gloss highlight and polished secondary anatomy
    composite_gloss = np.zeros((height, width), dtype=np.float32)
    c_highlight = np.clip(1.0 - np.sqrt((x - 410)**2 + (y - 390)**2) / 80.0, 0, 1)
    composite_color += c_highlight[:, :, np.newaxis] * 22.0
    
    # Flash / slight overfill region extending 6 pixels beyond distal margin
    flash_mask = np.clip(gaussian_filter(cavity_mask, sigma=4.0) * 1.15, 0.0, 1.0)
    
    f_mask_3d = np.repeat(cavity_mask[:, :, np.newaxis], 3, axis=2)
    postop_raw = img_tooth * (1.0 - f_mask_3d) + composite_color * f_mask_3d
    
    # Restored occlusal anatomy carved by finishing bur
    restored_groove = np.clip(1.0 - np.abs(y - (cy + 10 * np.sin((x - cx)/45.0))) / 2.0, 0, 1) * cavity_mask
    postop_raw -= restored_groove[:, :, np.newaxis] * 25.0
    
    # Slight margin line
    margin_seam = np.clip(gaussian_filter(cavity_mask, sigma=1.0) - gaussian_filter(cavity_mask, sigma=2.0), 0, 1)
    postop_raw -= margin_seam[:, :, np.newaxis] * 15.0
    
    pil_postop = Image.fromarray(np.clip(postop_raw, 0, 255).astype(np.uint8))
    draw_post = ImageDraw.Draw(pil_postop)
    # Keep calibration tag on postop too
    draw_post.rectangle([ruler_x0 - 15, ruler_y - 25, ruler_x1 + 15, ruler_y + 25], fill=(20, 28, 45, 230))
    draw_post.line([(ruler_x0, ruler_y), (ruler_x1, ruler_y)], fill=(0, 240, 255), width=4)
    draw_post.line([(ruler_x0, ruler_y - 8), (ruler_x0, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw_post.line([(ruler_x1, ruler_y - 8), (ruler_x1, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw_post.text((ruler_x0 + 65, ruler_y - 20), "CALIBRATION: 5.0 mm", fill=(255, 255, 255))
    
    # Save images
    preop_path = os.path.join(OUTPUT_DIR, "case_1_class_1_molar_cavity.png")
    postop_path = os.path.join(OUTPUT_DIR, "case_1_class_1_molar_restored.png")
    pil_preop.save(preop_path)
    pil_postop.save(postop_path)
    
    # True cavity volume integration:
    # dV = depth(x,y) * (dx * dy) where dx = dy = 1 / scale_px_per_mm = 1 / 50 = 0.02 mm
    area_per_px_mm2 = (1.0 / scale_px_per_mm) ** 2
    true_volume_mm3 = float(np.sum(depth_map_mm) * area_per_px_mm2)
    cavity_area_mm2 = float(np.sum(cavity_mask) * area_per_px_mm2)
    max_depth_mm = float(np.max(depth_map_mm))
    
    # Bounding dimensions
    y_indices, x_indices = np.where(cavity_mask > 0.5)
    length_mm = float((np.max(x_indices) - np.min(x_indices)) / scale_px_per_mm)
    width_mm = float((np.max(y_indices) - np.min(y_indices)) / scale_px_per_mm)
    
    metadata = {
        "case_id": "case_1_class_1_molar",
        "title": "Case 1: Mandibular Molar Class I Cavity",
        "tooth_type": "Mandibular First Molar (#36 / #19)",
        "preparation_type": "Class I Occlusal Cavity (G.V. Black)",
        "scale_px_per_mm": scale_px_per_mm,
        "calibration_marker_length_mm": 5.0,
        "calibration_marker_px": 250,
        "true_metrics": {
            "length_mm": round(length_mm, 2),
            "width_mm": round(width_mm, 2),
            "max_depth_mm": round(max_depth_mm, 2),
            "mean_depth_mm": round(float(np.mean(depth_map_mm[cavity_mask > 0.5])), 2),
            "surface_area_mm2": round(cavity_area_mm2, 2),
            "volume_mm3": round(true_volume_mm3, 2),
            "c_factor": 4.8
        },
        "preop_image": "samples/case_1_class_1_molar_cavity.png",
        "postop_image": "samples/case_1_class_1_molar_restored.png"
    }
    
    return metadata

def generate_case_2_class_2_premolar():
    """
    Maxillary Premolar with Class II MO (Mesio-Occlusal) Cavity Preparation.
    Scale: 50 pixels = 1.0 mm (Image size: 800x800)
    """
    width, height = 800, 800
    scale_px_per_mm = 50.0
    
    base = np.zeros((height, width, 3), dtype=np.float32)
    base[:, :] = [30, 50, 78] # Rubber dam
    
    cx, cy = 400, 400
    y, x = np.ogrid[:height, :width]
    
    # Premolar oval crown shape
    dist_crown = (((x - cx) / 190.0)**2 + ((y - cy) / 240.0)**2)
    tooth_mask = np.clip(1.0 - (dist_crown - 0.65) * 5.0, 0.0, 1.0)
    
    enamel_color = np.zeros((height, width, 3), dtype=np.float32)
    enamel_color[:, :] = [242, 236, 222]
    
    # Buccal and lingual cusp lobes
    cusps = [(400, 290), (400, 510)]
    for ccx, ccy in cusps:
        c_dist = np.sqrt((x - ccx)**2 + (y - ccy)**2)
        enamel_color += np.clip(1.0 - c_dist / 95.0, 0.0, 1.0)[:, :, np.newaxis] * 16.0
        
    t_mask_3d = np.repeat(tooth_mask[:, :, np.newaxis], 3, axis=2)
    img_tooth = base * (1.0 - t_mask_3d) + enamel_color * t_mask_3d
    
    # Class II MO cavity: Mesial proximal box + occlusal step
    cavity_mask = np.zeros((height, width), dtype=np.float32)
    # Occlusal isthmus
    box_occ = np.clip(1.0 - (((x - cx) / 75.0)**2 + ((y - cy) / 38.0)**2), 0.0, 1.0)
    # Mesial box (breaking contact point, deeper gingival seat)
    box_mesial = np.clip(1.0 - (((x - (cx - 100)) / 65.0)**2 + ((y - cy) / 80.0)**2), 0.0, 1.0)
    
    cavity_raw = np.maximum(box_occ, box_mesial)
    from scipy.ndimage import gaussian_filter, distance_transform_edt
    cavity_smooth = gaussian_filter((cavity_raw > 0.08).astype(np.float32), sigma=2.0)
    cavity_mask = (cavity_smooth > 0.45).astype(np.float32)
    
    dist_from_margin = distance_transform_edt(cavity_mask)
    max_dist_px = np.max(dist_from_margin)
    
    # Depth map: occlusal step ~2.0 mm, proximal box gingival floor ~3.6 mm
    depth_map_mm = np.zeros((height, width), dtype=np.float32)
    norm_depth = np.clip(dist_from_margin / (max_dist_px * 0.7), 0.0, 1.0)
    
    # Depth modifier: deeper on mesial side (x < cx - 40)
    mesial_depth_boost = np.clip((cx - x) / 100.0, 0.0, 1.0) * 1.6
    depth_map_mm = (1.0 - np.exp(-3.0 * norm_depth)) * (2.0 + mesial_depth_boost) * cavity_mask
    
    dentin_base = np.zeros((height, width, 3), dtype=np.float32)
    dentin_base[:, :] = [182, 142, 85]
    depth_shadow = 1.0 - 0.48 * (depth_map_mm / 3.6)
    dentin_floor = dentin_base * depth_shadow[:, :, np.newaxis]
    
    margin_edges = np.clip(gaussian_filter(cavity_mask, sigma=1.0) - gaussian_filter(cavity_mask, sigma=2.5), 0, 1)
    c_mask_3d = np.repeat(cavity_mask[:, :, np.newaxis], 3, axis=2)
    preop_img = img_tooth * (1.0 - c_mask_3d) + dentin_floor * c_mask_3d + margin_edges[:, :, np.newaxis] * 30.0
    
    # Calibration ruler
    pil_preop = Image.fromarray(np.clip(preop_img, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(pil_preop)
    ruler_x0, ruler_y = 60, 70
    ruler_x1 = ruler_x0 + int(5.0 * scale_px_per_mm)
    draw.rectangle([ruler_x0 - 15, ruler_y - 25, ruler_x1 + 15, ruler_y + 25], fill=(20, 28, 45, 230))
    draw.line([(ruler_x0, ruler_y), (ruler_x1, ruler_y)], fill=(0, 240, 255), width=4)
    draw.line([(ruler_x0, ruler_y - 8), (ruler_x0, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw.line([(ruler_x1, ruler_y - 8), (ruler_x1, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw.text((ruler_x0 + 65, ruler_y - 20), "CALIBRATION: 5.0 mm", fill=(255, 255, 255))
    
    # Post-op
    composite_color = np.zeros((height, width, 3), dtype=np.float32)
    composite_color[:, :] = [236, 230, 218]
    postop_raw = img_tooth * (1.0 - c_mask_3d) + composite_color * c_mask_3d
    pil_postop = Image.fromarray(np.clip(postop_raw, 0, 255).astype(np.uint8))
    draw_post = ImageDraw.Draw(pil_postop)
    draw_post.rectangle([ruler_x0 - 15, ruler_y - 25, ruler_x1 + 15, ruler_y + 25], fill=(20, 28, 45, 230))
    draw_post.line([(ruler_x0, ruler_y), (ruler_x1, ruler_y)], fill=(0, 240, 255), width=4)
    draw_post.line([(ruler_x0, ruler_y - 8), (ruler_x0, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw_post.line([(ruler_x1, ruler_y - 8), (ruler_x1, ruler_y + 8)], fill=(0, 240, 255), width=3)
    draw_post.text((ruler_x0 + 65, ruler_y - 20), "CALIBRATION: 5.0 mm", fill=(255, 255, 255))
    
    preop_path = os.path.join(OUTPUT_DIR, "case_2_class_2_premolar_cavity.png")
    postop_path = os.path.join(OUTPUT_DIR, "case_2_class_2_premolar_restored.png")
    pil_preop.save(preop_path)
    pil_postop.save(postop_path)
    
    area_per_px_mm2 = (1.0 / scale_px_per_mm) ** 2
    true_volume_mm3 = float(np.sum(depth_map_mm) * area_per_px_mm2)
    cavity_area_mm2 = float(np.sum(cavity_mask) * area_per_px_mm2)
    max_depth_mm = float(np.max(depth_map_mm))
    
    y_indices, x_indices = np.where(cavity_mask > 0.5)
    length_mm = float((np.max(x_indices) - np.min(x_indices)) / scale_px_per_mm)
    width_mm = float((np.max(y_indices) - np.min(y_indices)) / scale_px_per_mm)
    
    metadata = {
        "case_id": "case_2_class_2_premolar",
        "title": "Case 2: Maxillary Premolar Class II MO Cavity",
        "tooth_type": "Maxillary First Premolar (#24 / #12)",
        "preparation_type": "Class II Mesio-Occlusal (MO) Preparation",
        "scale_px_per_mm": scale_px_per_mm,
        "calibration_marker_length_mm": 5.0,
        "calibration_marker_px": 250,
        "true_metrics": {
            "length_mm": round(length_mm, 2),
            "width_mm": round(width_mm, 2),
            "max_depth_mm": round(max_depth_mm, 2),
            "mean_depth_mm": round(float(np.mean(depth_map_mm[cavity_mask > 0.5])), 2),
            "surface_area_mm2": round(cavity_area_mm2, 2),
            "volume_mm3": round(true_volume_mm3, 2),
            "c_factor": 3.2
        },
        "preop_image": "samples/case_2_class_2_premolar_cavity.png",
        "postop_image": "samples/case_2_class_2_premolar_restored.png"
    }
    return metadata

def main():
    print("Generating Greenmix clinical benchmark datasets...")
    c1 = generate_case_1_class_1_molar()
    c2 = generate_case_2_class_2_premolar()
    
    all_cases = {
        "cases": [c1, c2]
    }
    
    meta_path = os.path.join(OUTPUT_DIR, "cases_metadata.json")
    with open(meta_path, "w") as f:
        json.dump(all_cases, f, indent=2)
        
    print(f"Generated Case 1: V = {c1['true_metrics']['volume_mm3']} mm3, L = {c1['true_metrics']['length_mm']} mm, W = {c1['true_metrics']['width_mm']} mm, D = {c1['true_metrics']['max_depth_mm']} mm")
    print(f"Generated Case 2: V = {c2['true_metrics']['volume_mm3']} mm3, L = {c2['true_metrics']['length_mm']} mm, W = {c2['true_metrics']['width_mm']} mm, D = {c2['true_metrics']['max_depth_mm']} mm")
    print(f"Saved metadata to {meta_path}")

if __name__ == "__main__":
    main()
