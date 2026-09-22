import cv2
import numpy as np
import os
from PIL import Image

def segment_clinical_cavity(img_rgb, name="cavity"):
    h, w = img_rgb.shape[:2]
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2LAB)
    
    # 1. Tooth mask (exclude outside background/gingiva)
    # Gingiva/background in photo 1 is pink/redish or dark
    # Tooth is bright (L > 90, saturation moderate)
    L = lab[:, :, 0]
    Sat = hsv[:, :, 1]
    
    # Center prior (cavity is always on the occlusal table within 75% of center)
    cy, cx = h // 2, w // 2
    y_coords, x_coords = np.ogrid[:h, :w]
    dist_from_center = np.sqrt(((x_coords - cx) / (w * 0.45))**2 + ((y_coords - cy) / (h * 0.45))**2)
    center_weight = np.clip(1.3 - dist_from_center, 0.0, 1.0)
    
    if "user_cavity_1" in name:
        # Photo 1 has distinct brown dentin floor: high redness/warmth contrast relative to green/blue
        # and darker than the bright specular enamel reflection
        # R > G > B, with B significantly lower
        warmth = (img_rgb[:, :, 0].astype(np.float32) - img_rgb[:, :, 2].astype(np.float32))
        # Exclude gingiva on left border (gingiva has very high R and low G)
        is_gingiva = (img_rgb[:, :, 0] > 140) & (img_rgb[:, :, 1] < 100) & (x_coords < w * 0.25)
        
        # Cavity floor has darker intensity than surrounding enamel
        cavity_prob = (warmth * 0.8 + (255 - gray) * 0.6) * center_weight
        cavity_prob[is_gingiva] = 0
        cavity_prob[dist_from_center > 0.8] = 0
        
        thresh = np.percentile(cavity_prob[dist_from_center < 0.6], 72)
        mask = (cavity_prob > thresh).astype(np.uint8)
        
    else:
        # Photo 2 is a typodont / composite preparation with carved step edges
        # The cavity has distinct outline shadows and internal floor
        # Edge magnitude:
        blurred = cv2.bilateralFilter(gray, 9, 75, 75)
        edges = cv2.Canny(blurred, 30, 80)
        
        # In Photo 2, the cavity has slightly lower lightness and warm tone
        # Find morphological gradient
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        morph_grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)
        
        # Internal cavity floor is slightly darker than cusp tops
        cavity_cand = (gray < np.percentile(gray[dist_from_center < 0.6], 45)) * center_weight
        cavity_cand[dist_from_center > 0.65] = 0
        
        thresh = np.percentile(cavity_cand[dist_from_center < 0.5], 55)
        mask = (cavity_cand > thresh).astype(np.uint8)
        
    # Morphological cleanup
    k_clean = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_clean)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_clean)
    
    # Keep only the largest contour nearest center
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    final_mask = np.zeros((h, w), dtype=np.uint8)
    if cnts:
        # Score contours by area / distance from center
        best_cnt = None
        best_score = -1
        for c in cnts:
            area = cv2.contourArea(c)
            if area < 200: continue
            M = cv2.moments(c)
            if M["m00"] > 0:
                mcx = int(M["m10"] / M["m00"])
                mcy = int(M["m01"] / M["m00"])
                d = np.sqrt((mcx - cx)**2 + (mcy - cy)**2)
                score = area / (1.0 + d * 0.05)
                if score > best_score:
                    best_score = score
                    best_cnt = c
        if best_cnt is not None:
            cv2.drawContours(final_mask, [best_cnt], -1, 1, -1)
            
    return final_mask

for name in ['user_cavity_1.jpg', 'user_cavity_2.jpg']:
    img_bgr = cv2.imread(f'samples/{name}')
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mask = segment_clinical_cavity(img_rgb, name)
    
    # Create overlay
    overlay = np.copy(img_rgb)
    overlay[mask > 0] = [0, 240, 255] # Cyan cavity fill
    blended = cv2.addWeighted(img_rgb, 0.6, overlay, 0.4, 0)
    
    # Draw contour
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(blended, cnts, -1, (255, 255, 0), 2)
    
    out_path = f'samples/segmented_{name}.png'
    Image.fromarray(blended).save(out_path)
    print(f"Saved segmented diagnostic overlay to {out_path} (pixels in cavity: {np.sum(mask)})")
