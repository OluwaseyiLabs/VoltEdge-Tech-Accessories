// VoltEdge Tech & Accessories - Complete Product Catalog & Specs Data

const PRODUCTS_DATA = [
  {
    id: "ve-pb-30k-blk",
    sku: "VE-PB-30K-BLK",
    name: "30,000mAh Laptop Power Bank (Black)",
    shortName: "30,000mAh Power Bank (Black)",
    category: "powerbanks",
    categoryLabel: "Laptop Power Banks",
    price: 65000,
    badge: "Bestseller",
    badgeType: "hot",
    rating: 4.9,
    reviewsCount: 38,
    image: "assets/images/pb-black.jpg",
    specsHighlight: "65W PD Fast Charging",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Matte Black finish",
    inStock: true,
    tagline: "Uninterrupted laptop power during grid drops and long remote work days.",
    bullets: [
      "65W Power Delivery (PD 3.0) fast charging output",
      "Massive 30,000mAh true capacity (charges typical laptop 1.5–2x, phones 6–8x)",
      "High-contrast digital LED battery percentage display",
      "Tri-port output: 2x USB-C PD + 1x USB-A QC 3.0",
      "Matte scratch-resistant anodized enclosure with heat dissipation",
      "Universal compatibility: MacBook Pro/Air, Dell XPS, HP Spectre, ThinkPad, ASUS, iPad & iPhones"
    ],
    technicalSpecs: {
      "Capacity": "30,000mAh / 111Wh (Airline travel compliant)",
      "USB-C1 In/Out": "5V/3A, 9V/3A, 12V/3A, 15V/3A, 20V/3.25A (65W Max)",
      "USB-C2 Output": "5V/3A, 9V/2.22A, 12V/1.67A (20W Max)",
      "USB-A Output": "4.5V/5A, 5V/4.5A, 9V/2A, 12V/1.5A (22.5W Max)",
      "Recharge Time": "~2.5 hours with 65W GaN wall charger",
      "Display": "Digital LED display (0-100% precision indicator)",
      "Safety Protection": "Overcharge, short-circuit, over-temp, over-voltage smart chip"
    }
  },
  {
    id: "ve-pb-30k-slv",
    sku: "VE-PB-30K-SLV",
    name: "30,000mAh Laptop Power Bank (Silver)",
    shortName: "30,000mAh Power Bank (Silver)",
    category: "powerbanks",
    categoryLabel: "Laptop Power Banks",
    price: 65000,
    badge: "Popular",
    badgeType: "accent",
    rating: 4.9,
    reviewsCount: 29,
    image: "assets/images/pb-silver.jpg",
    specsHighlight: "65W PD Fast Charging",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Metallic Silver finish",
    inStock: true,
    tagline: "Sleek aviation-grade brushed aluminum power bank engineered for executive desks.",
    bullets: [
      "65W Power Delivery fast charging for laptops, ultrabooks, and smartphones",
      "Brushed Metallic Silver casing matches silver MacBooks & ultrabooks",
      "Smart digital circular LED battery readout with quick-charge indicator",
      "Charge 3 devices simultaneously with dynamic power distribution",
      "Subtle thermal control technology prevents overheating under heavy load",
      "1-Year full replacement warranty included"
    ],
    technicalSpecs: {
      "Capacity": "30,000mAh / 111Wh",
      "Total Max Output": "65W concurrent Power Delivery",
      "Finish": "Aircraft brushed metallic silver with chamfered edges",
      "Battery Cell Type": "High-density Lithium-Polymer Grade A+",
      "Protection": "MultiProtect 10-point active safety suite",
      "Dimensions / Weight": "154 x 68 x 38mm / 560g"
    }
  },
  {
    id: "ve-ups-12v-wht",
    sku: "VE-UPS-12V-WHT",
    name: "Mini Wi-Fi Router UPS Backup (12V)",
    shortName: "Mini Router UPS Backup (12V)",
    category: "ups",
    categoryLabel: "Wi-Fi UPS Backups",
    price: 35000,
    badge: "Remote Must-Have",
    badgeType: "highlight",
    rating: 5.0,
    reviewsCount: 54,
    image: "assets/images/ups-white.jpg",
    specsHighlight: "Zero-Latency Power Switchover",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Arctic White finish",
    inStock: true,
    tagline: "Never get disconnected from Zoom, Google Meet, or Slack when power switches.",
    bullets: [
      "Automatic 0-second switchover: router doesn't reboot during grid failure",
      "Up to 6 hours continuous backup for Wi-Fi routers, fiber ONTs, and CCTV cameras",
      "Dual DC output ports (9V & 12V selectable) with standard DC barrel adapters included",
      "Clean Arctic White upright footprint designed for shelves and media desks",
      "Overload, overdischarge, and short-circuit electronic protection",
      "Plug & play inline installation — simply connects between wall adapter and router"
    ],
    technicalSpecs: {
      "Battery Capacity": "10,000mAh LiFePO4 / High-Cycle Li-ion",
      "Output Voltages": "9V DC (1A), 12V DC (2A), USB 5V (2A)",
      "Switchover Speed": "0 ms (True seamless uninterruptible power supply)",
      "Backup Duration": "4 to 6 hours depending on router power draw",
      "Compatibility": "MTN 5G / Airtel 5G / Starlink (Gen 2/3 mini adapters) / Spectranet / Smile / Fiber ONTs / TP-Link / Huawei / D-Link",
      "Accessories Included": "Splitter DC cable, standard barrel jack adapters, power cord"
    }
  },
  {
    id: "ve-std-pro-gry",
    sku: "VE-STD-PRO-GRY",
    name: "Ergonomic Aluminum Laptop Stand",
    shortName: "Ergonomic Aluminum Stand",
    category: "ergonomics",
    categoryLabel: "Ergonomic Stands",
    price: 40000,
    badge: "Ergonomic Pro",
    badgeType: "neutral",
    rating: 4.8,
    reviewsCount: 31,
    image: "assets/images/stand-grey.jpg",
    specsHighlight: "Heavy-Duty Aircraft Aluminum",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Space Grey finish",
    inStock: true,
    tagline: "Correct neck posture and enhance laptop airflow with precision anodized alloy.",
    bullets: [
      "Heavy-duty aircraft-grade aluminum alloy supporting laptops up to 10kg",
      "Stepless height and angle adjustment to bring laptop screen exactly to eye level",
      "Strategic open ventilation cutout prevents thermal throttling under intense workloads",
      "Full non-slip silicone pads on cradle, arms, and base prevent scratches and wobble",
      "Foldable design folds flat for easy transport in backpack or laptop bag",
      "Space Grey premium blasted finish"
    ],
    technicalSpecs: {
      "Material": "Solid CNC-machined Aircraft Aluminum Alloy (3.5mm thickness)",
      "Supported Devices": "All 10-inch to 17.3-inch laptops & tablets",
      "Weight Capacity": "Tested rock-solid up to 10kg load",
      "Adjustability": "Dual-axis pivot with tension-tuned damping hinges (Hex wrench included)",
      "Folded Dimensions": "260 x 230 x 45mm",
      "Weight": "790g"
    }
  },
  {
    id: "ve-mse-ergo-blk",
    sku: "VE-MSE-ERGO-BLK",
    name: "Precision Dual-Mode Wireless Ergonomic Mouse (Silent Clicks, 2.4G + BT 5.2)",
    shortName: "Precision Ergonomic Wireless Mouse",
    category: "ergonomics",
    categoryLabel: "Ergonomic Accessories",
    price: 87000,
    badge: "Ergonomic Pick",
    badgeType: "accent",
    rating: 4.9,
    reviewsCount: 23,
    image: "assets/images/mouse-ergo.jpg",
    specsHighlight: "Silent Clicks & Dual 2.4G/BT 5.2",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Matte Stealth Black finish",
    inStock: true,
    tagline: "Sculpted ergonomic contour with silent tactile switches to eliminate wrist fatigue during long remote work sessions.",
    bullets: [
      "Dual connectivity: ultra-fast 2.4GHz wireless USB receiver + Bluetooth 5.2 multi-device pairing",
      "90% noise reduction silent micro-switches for distraction-free clicking during video calls",
      "Sculpted palm contour with textured thumb cradle engineered for natural neutral wrist alignment",
      "Machined metal precision knurled scroll wheel with smooth ratchet tracking",
      "Adjustable high-precision optical sensor (800 / 1200 / 1600 / 2400 / 4000 DPI)",
      "Rechargeable USB-C fast-charging battery with up to 70 days of battery life per charge"
    ],
    technicalSpecs: {
      "Connectivity": "Dual-Mode (2.4GHz USB Nano Dongle + Bluetooth 5.2)",
      "Sensor / DPI": "High-Precision Optical Engine (800 - 4000 DPI 5-level switch)",
      "Switches": "Silent acoustic damping micro-switches (>10M click lifecycle)",
      "Battery": "Rechargeable 600mAh Li-Po, USB-C Fast Charge (Up to 70 days)",
      "Compatibility": "macOS, Windows 10/11, iPadOS, Linux, Android",
      "Dimensions / Weight": "120 x 78 x 46mm / 105g ergonomic balance weight"
    }
  },
  {
    id: "ve-bnd-wfh-01",
    sku: "VE-BND-WFH-01",
    name: "Work-From-Home Starter Bundle",
    shortName: "WFH Starter Bundle (4-in-1)",
    category: "bundles",
    categoryLabel: "Productivity Bundles",
    price: 165000,
    badge: "Best Value (Save ₦20,000+)",
    badgeType: "bundle",
    rating: 5.0,
    reviewsCount: 42,
    image: "assets/images/bundle-wfh.jpg",
    specsHighlight: "Complete Remote Setup Kit",
    warranty: "1-Year Product Warranty",
    dispatchBadge: "Same-Day Dispatch Eligible",
    finish: "Coordinated Space Grey & Matte Black",
    inStock: true,
    tagline: "Everything you need to turn any room into an all-day, outage-proof powerhouse.",
    bullets: [
      "1x VE-PB-30K-BLK 30,000mAh 65W PD Laptop Power Bank",
      "1x VE-STD-PRO-GRY Ergonomic Aircraft Aluminum Laptop Stand",
      "1x VE-MSE-ERGO-BLK Precision Dual-Mode Wireless Ergonomic Mouse (Silent Clicks, 2.4G + BT 5.2)",
      "1x Studio Ring Light with adjustable color temperature & desk mount",
      "Packaged together with fast-track same-day delivery coordination",
      "Over ₦20,000 in savings compared to purchasing each unit separately"
    ],
    technicalSpecs: {
      "Includes": "Power Bank (65W PD 30k mAh) + Aluminum Stand + Silent Mouse + Studio Ring Light",
      "Warranty": "1-Year comprehensive coverage across all bundle components",
      "Packaging": "Heavy-duty gift/corporate unboxing grade carton",
      "Ideal For": "Remote engineers, creatives, managers, consultants, and tech teams"
    }
  }
];

const CREATOR_ACCESSORIES = [
  {
    id: "ve-hub-7in1",
    sku: "VE-HUB-7IN1",
    title: "USB-C Hubs and Multiport Adapters",
    subtitle: "7-in-1 100W PD & 4K HDMI",
    description: "Expand your MacBook or ultrabook with 4K HDMI @ 60Hz, 100W Power Delivery pass-through, SD/TF card reader, and high-speed USB 3.0 ports.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/hub-usbc.jpg",
    features: ["4K 60Hz HDMI video output", "100W PD Pass-through port", "Dual USB 3.0 5Gbps ports", "MicroSD & SD UHS-I reader"]
  },
  {
    id: "ve-mic-lav2",
    sku: "VE-MIC-LAV2",
    title: "Wireless Lavalier Microphones",
    subtitle: "Dual-Channel Studio Noise Reduction",
    description: "Broadcast-quality lapel mics with active DSP noise cancellation, 8-hour battery, digital battery charging case, and plug-and-play Type-C/Lightning receiver.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/lavalier-mic.jpg",
    features: ["Dual transmitter + 1 receiver", "Smart AI noise reduction", "Up to 50m stable range", "Charging case with LCD display"]
  },
  {
    id: "ve-cam-1080p",
    sku: "VE-CAM-1080P",
    title: "Webcams & Video-Conferencing Accessories",
    subtitle: "Full HD 1080P 60FPS with Built-in Privacy Shutter",
    description: "Ultra-sharp video conferencing webcam with autofocus, dual stereo microphones, and ring light fill for executive remote presentations.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/bundle-wfh.jpg",
    features: ["1080P 60FPS fluid video", "Integrated ring fill light", "Stereo noise-canceling mic", "Physical privacy shutter"]
  },
  {
    id: "ve-lgt-ring",
    sku: "VE-LGT-RING",
    title: "Compact Ring Lights",
    subtitle: "Variable Color Temp & Desk Clamp",
    description: "Even, flicker-free illumination with 3 color temperatures (3200K - 6500K) and 10 brightness steps. Keeps you looking professional on calls.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/bundle-wfh.jpg",
    features: ["3 light tones (Warm/Natural/Cool)", "10 brightness intensity levels", "Heavy-duty desk C-clamp", "Inline USB control pad"]
  },
  {
    id: "ve-mnt-desk",
    sku: "VE-MNT-DESK",
    title: "Desk Tripods and Phone Mounts",
    subtitle: "360° Ball Head Articulating Arm",
    description: "Sturdy aluminum desk mounts and low-profile tripods to securely position smartphones, cameras, and key lights without cluttering desk space.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/stand-grey.jpg",
    features: ["360-degree rotation ball head", "Universal 1/4\" screw thread", "Weighted anti-tip base", "Silicon grip phone holder"]
  },
  {
    id: "ve-kbd-slim",
    sku: "VE-KBD-SLIM",
    title: "Wireless Keyboards and Mice",
    subtitle: "Silent Low-Profile Bluetooth & 2.4G",
    description: "Quiet scissor-switch typing feel with multi-device pairing. Switch effortlessly between Mac, Windows PC, tablet, and mobile device.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/mouse-ergo.jpg",
    features: ["Whisper-quiet scissor keys", "3-device Bluetooth switching", "Rechargeable Type-C battery", "Ergonomic slim incline"]
  },
  {
    id: "ve-cbl-mgm",
    sku: "VE-CBL-MGM",
    title: "Cable Management Accessories",
    subtitle: "Magnetic Clips & Weighted Desktop Organizers",
    description: "Clean desk setup essentials: magnetic silicone cable clips, under-desk cable raceways, and braided cable sleeves to eliminate clutter.",
    status: "Available by Enquiry / Pre-order",
    image: "assets/images/bundle-wfh.jpg",
    features: ["High-strength magnetic clips", "Reusable non-residue adhesive", "Fits cables up to 6mm", "Matte silicone finish"]
  }
];

const REVIEWS_DATA = [
  {
    name: "Sarah O.",
    role: "Senior UI/UX Designer, Paystack Ecosystem",
    location: "Lekki Phase 1, Lagos",
    product: "30,000mAh Laptop Power Bank (Black)",
    rating: 5,
    date: "Verified Customer • 4 days ago",
    content: "VoltEdge saved my project deadline last week when our estate generator broke down during a 14-hour outage. My 16\" MacBook Pro stayed powered all day while on Figma and video calls. The 65W PD is real fast charging, not gimmick. 10/10 investment."
  },
  {
    name: "Tunde Bakare",
    role: "Lead Backend Engineer (Remote UK Firm)",
    location: "Wuse 2, Abuja",
    product: "Mini Wi-Fi Router UPS Backup (12V)",
    rating: 5,
    date: "Verified Customer • 1 week ago",
    content: "The zero-second switchover on the 12V UPS is magic. Before this, every time the power went off, my router rebooted and dropped my production deploy sessions. Now the router doesn't even flicker. Battery lasts over 5 hours with my 5G router."
  },
  {
    name: "Chidi Kalu",
    role: "Founder & Product Manager",
    location: "GRA Phase 2, Port Harcourt",
    product: "Work-From-Home Starter Bundle",
    rating: 5,
    date: "Verified Customer • 2 weeks ago",
    content: "Ordered the WFH bundle for myself and then requested 3 more for my key team leads. Delivered promptly, genuine warranty documentation included, and the aluminum stand feels as solid as an Apple product. Excellent customer service on WhatsApp."
  },
  {
    name: "Amina Mohammed",
    role: "Tech Consultant & Creator",
    location: "Victoria Island, Lagos",
    product: "30,000mAh Laptop Power Bank (Silver)",
    rating: 5,
    date: "Verified Customer • 3 weeks ago",
    content: "The silver finish matches my Silver M3 MacBook Air gorgeously! The LED screen showing exact percentage eliminates all battery anxiety. Ordered before 2 PM and received it same evening in VI. Highly recommended!"
  }
];

const FAQS_DATA = [
  {
    question: "What core products are currently available to order directly?",
    answer: "You can directly order our five core catalog products: the 30,000mAh Laptop Power Bank in Matte Black or Metallic Silver (₦65,000), the Mini Wi-Fi Router UPS Backup 12V (₦35,000), the Ergonomic Aluminum Laptop Stand (₦40,000), and the complete Work-From-Home Starter Bundle (₦165,000). Creator accessories are currently available by enquiry and pre-order."
  },
  {
    question: "How does the order and payment process work?",
    answer: "Submitting the form on this website logs your order directly with our warehouse and fulfillment desk. This is an order reservation and submission, not an instant automated card charge. Once submitted, our team immediately verifies your details, confirms delivery timing and any applicable courier fees based on your location, and communicates payment options (direct bank transfer / payment on delivery for eligible locations)."
  },
  {
    question: "When is the cut-off for same-day dispatch?",
    answer: "Orders submitted before 2:00 PM (West Africa Time) are processed in our afternoon wave and dispatched the same day for delivery via our trusted dispatch couriers (applicable in Lagos, Abuja, and major hubs). Orders submitted after 2:00 PM are queued into our 11:00 AM wave the following business morning."
  },
  {
    question: "What does the 1-Year Product Warranty cover?",
    answer: "Every single VoltEdge unit carries an official 1-year replacement warranty covering factory defects, battery cell degradation outside standard specs, circuitry failures, or power delivery anomalies under normal use. If any issue arises, contact our support team on WhatsApp with your Order ID for hassle-free diagnostics and replacement."
  },
  {
    question: "Can I place bulk or corporate orders for my company/team?",
    answer: "Yes, absolutely! We equip startup teams, corporate departments, and remote organizations across Nigeria. We provide customized corporate invoices, company tax receipts, volume pricing tiers, and coordinated multi-employee doorstep delivery. Click 'Equip Your Team' or message us directly on WhatsApp."
  },
  {
    question: "How are delivery charges and locations handled?",
    answer: "We ship nationwide across all 36 Nigerian states and the FCT. Same-day express dispatch is available within Lagos and Abuja. Regional deliveries across other states typically arrive within 24 to 48 hours via vetted interstate logistics partners. Exact delivery fees are calculated and confirmed transparently with you before shipment."
  },
  {
    question: "How do I enquire about creator accessories (Hubs, Mics, Ring Lights)?",
    answer: "Click the 'Ask About Availability' button on any accessory card or tap the WhatsApp button. Our team will share current batch ETA, custom package pricing, and priority reservation links. Accessory enquiries are non-committal and never auto-bill you."
  }
];
