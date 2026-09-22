import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

def create_restoration_pair(img_path, mask_func, out_pre, out_post, tooth_name, scale_px_per_mm, depth_mm):
    img = cv2.imread(img_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img_rgb.shape[:2]
    
    # Get mask
    mask = mask_func(img_rgb, img_path)
    
    # Composite color: match enamel tone (A2/A3 shade composite)
    # Sample enamel color from tooth cusps
    tooth_enamel_sample = img_rgb[int(h*0.2):int(h*0.3), int(w*0.5):int(w*0.6)]
    comp_color = np.mean(tooth_enamel_sample, axis=(0,1))
    
    # Build restored image: composite fills the cavity
    postop = np.copy(img_rgb).astype(np.float32)
    c_mask_3d = np.repeat(mask[:, :, np.newaxis], 3, axis=2).astype(np.float32)
    
    # Fill cavity with composite color + surface anatomy highlights
    composite_layer = np.zeros_like(postop)
    composite_layer[:, :] = comp_color
    
    # Add subtle secondary occlusal fissure carving
    cy, cx = h // 2, w // 2
    y, x = np.ogrid[:h, :w]
    fissure = np.clip(1.0 - np.abs(y - (cy + 6 * np.sin((x - cx) / 25.0))) / 2.0, 0, 1) * mask
    composite_layer -= fissure[:, :, np.newaxis] * 18.0
    
    # Cured resin gloss reflection
    gloss = np.clip(1.0 - np.sqrt((x - cx - 15)**2 + (y - cy - 10)**2) / (w * 0.18), 0, 1) * mask
    composite_layer += gloss[:, :, np.newaxis] * 20.0
    
    # Blend into cavity
    postop = postop * (1.0 - c_mask_3d) + composite_layer * c_mask_3d
    
    # Margin flash / slight finishing boundary
    margin_flash = np.clip(gaussian_filter(mask.astype(np.float32), 2.0) - mask.astype(np.float32), 0, 1)
    postop += margin_flash[:, :, np.newaxis] * 12.0
    
    postop_uint8 = np.clip(postop, 0, 255).astype(np.uint8)
    
    # Save pre-op and post-op
    Image.fromarray(img_rgb).save(out_pre)
    Image.fromarray(postop_uint8).save(out_post)
    print(f"Generated restored counterpart: {out_post}")

from test_user_segmentation import segment_clinical_cavity

create_restoration_pair(
    'samples/user_cavity_1.jpg',
    segment_clinical_cavity,
    'samples/user_cavity_1_preop.jpg',
    'samples/user_cavity_1_restored.jpg',
    'Mandibular First Molar (#36)',
    scale_px_per_mm=32.5,
    depth_mm=2.5
)

create_restoration_pair(
    'samples/user_cavity_2.jpg',
    segment_clinical_cavity,
    'samples/user_cavity_2_preop.jpg',
    'samples/user_cavity_2_restored.jpg',
    'Molar Typodont Preparation',
    scale_px_per_mm=65.0,
    depth_mm=2.2
)
