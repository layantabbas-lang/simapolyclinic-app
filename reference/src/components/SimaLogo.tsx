import React, { useState } from "react";

interface SimaLogoProps {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  darkBackground?: boolean;
  withContainer?: boolean;
}

export function SimaLogo({ 
  size = "md", 
  darkBackground = true, 
  withContainer = true 
}: SimaLogoProps) {
  
  const [imgSrc, setImgSrc] = useState<string>("/logo.svg");
  const [tryCount, setTryCount] = useState<number>(0);

  // Sizing styles for the image itself
  let width = "120px";
  let height = "36px";
  let padding = "10px 24px";
  let borderRadius = "10px";
  
  switch (size) {
    case "xs":
      width = "60px";
      height = "18px";
      padding = "2px 6px";
      borderRadius = "4px";
      break;
    case "sm":
      width = "80px";
      height = "24px";
      padding = "4px 12px";
      borderRadius = "6px";
      break;
    case "md":
      width = "130px";
      height = "38px";
      padding = "10px 24px";
      borderRadius = "10px";
      break;
    case "lg":
      width = "200px";
      height = "60px";
      padding = "16px 36px";
      borderRadius = "14px";
      break;
    case "xl":
      width = "280px";
      height = "84px";
      padding = "24px 56px";
      borderRadius = "18px";
      break;
  }

  // Handle image error to cycle through possible uploaded names and finally fallback to generated SVG
  const handleImageError = () => {
    if (tryCount === 0) {
      // Try local logo.png next
      setImgSrc("/logo.png");
      setTryCount(1);
    } else if (tryCount === 1) {
      // Try logo.jpg next
      setImgSrc("/logo.jpg");
      setTryCount(2);
    } else if (tryCount === 2) {
      // Try logo.jpeg next
      setImgSrc("/logo.jpeg");
      setTryCount(3);
    } else if (tryCount === 3) {
      // Try logo.svg next
      setImgSrc("/logo.svg");
      setTryCount(4);
    } else if (tryCount === 4) {
      // Fallback to our generated clean SVGs
      setImgSrc(darkBackground ? "/logo-light.svg" : "/logo-dark.svg");
      setTryCount(5);
    }
  };

  const imageElement = (
    <img 
      src={imgSrc} 
      alt="SIMA Logo" 
      onError={handleImageError}
      style={{
        width: width,
        height: height,
        display: "block",
        objectFit: "contain",
      }}
      referrerPolicy="no-referrer"
    />
  );

  if (!withContainer) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center" }}>
        {imageElement}
      </div>
    );
  }

  return (
    <div
      id={`sima-logo-${size}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: darkBackground ? "#2b3949" : "#dee9f3", // Slate Blue or Crisp Mint
        padding: padding,
        borderRadius: borderRadius,
        userSelect: "none",
        border: darkBackground 
          ? "1px solid rgba(13, 148, 136, 0.2)" 
          : "1px solid rgba(13, 148, 136, 0.15)",
        boxShadow: darkBackground 
          ? "0 4px 12px rgba(15, 23, 42, 0.3)" 
          : "0 2px 8px rgba(13, 148, 136, 0.05)",
      }}
    >
      {imageElement}
    </div>
  );
}
