/**
 * Indian Local Governing Authority Dataset
 * 
 * Types:
 *  - "corporation" → Municipal Corporation (Mahanagar Palika) — Large cities
 *  - "council"     → Municipal Council (Nagar Palika / Nagar Parishad) — Towns
 *  - "panchayat"   → Gram Panchayat — Villages (default fallback)
 */

// ============================================================
// MUNICIPAL CORPORATIONS (Major Indian Cities)
// ============================================================
export const municipalCorporations = [
  // Maharashtra
  { name: "Mumbai", aliases: ["Bombay", "Greater Mumbai"], district: "Mumbai", state: "Maharashtra" },
  { name: "Pune", aliases: ["Poona"], district: "Pune", state: "Maharashtra" },
  { name: "Nagpur", aliases: [], district: "Nagpur", state: "Maharashtra" },
  { name: "Thane", aliases: ["Thana"], district: "Thane", state: "Maharashtra" },
  { name: "Nashik", aliases: ["Nasik"], district: "Nashik", state: "Maharashtra" },
  { name: "Aurangabad", aliases: ["Sambhajinagar", "Chhatrapati Sambhajinagar"], district: "Aurangabad", state: "Maharashtra" },
  { name: "Solapur", aliases: ["Sholapur"], district: "Solapur", state: "Maharashtra" },
  { name: "Kolhapur", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Amravati", aliases: ["Amaravati"], district: "Amravati", state: "Maharashtra" },
  { name: "Navi Mumbai", aliases: ["New Bombay"], district: "Thane", state: "Maharashtra" },
  { name: "Pimpri-Chinchwad", aliases: ["Pimpri", "Chinchwad", "PCMC"], district: "Pune", state: "Maharashtra" },
  { name: "Kalyan-Dombivli", aliases: ["Kalyan", "Dombivli", "KDMC"], district: "Thane", state: "Maharashtra" },
  { name: "Vasai-Virar", aliases: ["Vasai", "Virar"], district: "Palghar", state: "Maharashtra" },
  { name: "Mira-Bhayandar", aliases: ["Mira Road", "Bhayandar"], district: "Thane", state: "Maharashtra" },
  { name: "Bhiwandi-Nizampur", aliases: ["Bhiwandi"], district: "Thane", state: "Maharashtra" },
  { name: "Ulhasnagar", aliases: [], district: "Thane", state: "Maharashtra" },
  { name: "Sangli-Miraj-Kupwad", aliases: ["Sangli", "Miraj"], district: "Sangli", state: "Maharashtra" },
  { name: "Malegaon", aliases: [], district: "Nashik", state: "Maharashtra" },
  { name: "Nanded-Waghala", aliases: ["Nanded"], district: "Nanded", state: "Maharashtra" },
  { name: "Dhule", aliases: ["Dhulia"], district: "Dhule", state: "Maharashtra" },
  { name: "Jalgaon", aliases: [], district: "Jalgaon", state: "Maharashtra" },
  { name: "Akola", aliases: [], district: "Akola", state: "Maharashtra" },
  { name: "Latur", aliases: [], district: "Latur", state: "Maharashtra" },
  { name: "Ahmednagar", aliases: ["Ahmadnagar"], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Chandrapur", aliases: [], district: "Chandrapur", state: "Maharashtra" },
  { name: "Parbhani", aliases: [], district: "Parbhani", state: "Maharashtra" },

  // Karnataka
  { name: "Bangalore", aliases: ["Bengaluru", "Bengaluru Urban"], district: "Bangalore", state: "Karnataka" },
  { name: "Mysore", aliases: ["Mysuru"], district: "Mysore", state: "Karnataka" },
  { name: "Hubli-Dharwad", aliases: ["Hubli", "Dharwad", "Hubballi", "Dharwad"], district: "Dharwad", state: "Karnataka" },
  { name: "Mangalore", aliases: ["Mangaluru"], district: "Dakshina Kannada", state: "Karnataka" },
  { name: "Belgaum", aliases: ["Belagavi"], district: "Belgaum", state: "Karnataka" },
  { name: "Gulbarga", aliases: ["Kalaburagi"], district: "Gulbarga", state: "Karnataka" },
  { name: "Davanagere", aliases: ["Davangere"], district: "Davanagere", state: "Karnataka" },
  { name: "Bellary", aliases: ["Ballari"], district: "Bellary", state: "Karnataka" },
  { name: "Shimoga", aliases: ["Shivamogga"], district: "Shimoga", state: "Karnataka" },
  { name: "Tumkur", aliases: ["Tumakuru"], district: "Tumkur", state: "Karnataka" },

  // Tamil Nadu
  { name: "Chennai", aliases: ["Madras"], district: "Chennai", state: "Tamil Nadu" },
  { name: "Coimbatore", aliases: ["Kovai"], district: "Coimbatore", state: "Tamil Nadu" },
  { name: "Madurai", aliases: [], district: "Madurai", state: "Tamil Nadu" },
  { name: "Tiruchirappalli", aliases: ["Trichy"], district: "Tiruchirappalli", state: "Tamil Nadu" },
  { name: "Salem", aliases: [], district: "Salem", state: "Tamil Nadu" },
  { name: "Tirunelveli", aliases: [], district: "Tirunelveli", state: "Tamil Nadu" },
  { name: "Tiruppur", aliases: [], district: "Tiruppur", state: "Tamil Nadu" },
  { name: "Erode", aliases: [], district: "Erode", state: "Tamil Nadu" },
  { name: "Vellore", aliases: [], district: "Vellore", state: "Tamil Nadu" },
  { name: "Thanjavur", aliases: ["Tanjore"], district: "Thanjavur", state: "Tamil Nadu" },

  // Telangana & Andhra Pradesh
  { name: "Hyderabad", aliases: ["GHMC"], district: "Hyderabad", state: "Telangana" },
  { name: "Warangal", aliases: [], district: "Warangal", state: "Telangana" },
  { name: "Visakhapatnam", aliases: ["Vizag"], district: "Visakhapatnam", state: "Andhra Pradesh" },
  { name: "Vijayawada", aliases: [], district: "Krishna", state: "Andhra Pradesh" },
  { name: "Guntur", aliases: [], district: "Guntur", state: "Andhra Pradesh" },
  { name: "Tirupati", aliases: [], district: "Chittoor", state: "Andhra Pradesh" },
  { name: "Rajahmundry", aliases: ["Rajamahendravaram"], district: "East Godavari", state: "Andhra Pradesh" },
  { name: "Kakinada", aliases: [], district: "East Godavari", state: "Andhra Pradesh" },

  // Kerala
  { name: "Thiruvananthapuram", aliases: ["Trivandrum"], district: "Thiruvananthapuram", state: "Kerala" },
  { name: "Kochi", aliases: ["Cochin", "Ernakulam"], district: "Ernakulam", state: "Kerala" },
  { name: "Kozhikode", aliases: ["Calicut"], district: "Kozhikode", state: "Kerala" },
  { name: "Thrissur", aliases: ["Trichur"], district: "Thrissur", state: "Kerala" },
  { name: "Kollam", aliases: ["Quilon"], district: "Kollam", state: "Kerala" },

  // Gujarat
  { name: "Ahmedabad", aliases: ["Amdavad"], district: "Ahmedabad", state: "Gujarat" },
  { name: "Surat", aliases: [], district: "Surat", state: "Gujarat" },
  { name: "Vadodara", aliases: ["Baroda"], district: "Vadodara", state: "Gujarat" },
  { name: "Rajkot", aliases: [], district: "Rajkot", state: "Gujarat" },
  { name: "Bhavnagar", aliases: [], district: "Bhavnagar", state: "Gujarat" },
  { name: "Jamnagar", aliases: [], district: "Jamnagar", state: "Gujarat" },
  { name: "Junagadh", aliases: [], district: "Junagadh", state: "Gujarat" },
  { name: "Gandhinagar", aliases: [], district: "Gandhinagar", state: "Gujarat" },

  // Rajasthan
  { name: "Jaipur", aliases: [], district: "Jaipur", state: "Rajasthan" },
  { name: "Jodhpur", aliases: [], district: "Jodhpur", state: "Rajasthan" },
  { name: "Udaipur", aliases: [], district: "Udaipur", state: "Rajasthan" },
  { name: "Kota", aliases: [], district: "Kota", state: "Rajasthan" },
  { name: "Ajmer", aliases: [], district: "Ajmer", state: "Rajasthan" },
  { name: "Bikaner", aliases: [], district: "Bikaner", state: "Rajasthan" },

  // Madhya Pradesh
  { name: "Bhopal", aliases: [], district: "Bhopal", state: "Madhya Pradesh" },
  { name: "Indore", aliases: [], district: "Indore", state: "Madhya Pradesh" },
  { name: "Jabalpur", aliases: [], district: "Jabalpur", state: "Madhya Pradesh" },
  { name: "Gwalior", aliases: [], district: "Gwalior", state: "Madhya Pradesh" },
  { name: "Ujjain", aliases: [], district: "Ujjain", state: "Madhya Pradesh" },

  // Uttar Pradesh
  { name: "Lucknow", aliases: [], district: "Lucknow", state: "Uttar Pradesh" },
  { name: "Kanpur", aliases: ["Cawnpore"], district: "Kanpur Nagar", state: "Uttar Pradesh" },
  { name: "Agra", aliases: [], district: "Agra", state: "Uttar Pradesh" },
  { name: "Varanasi", aliases: ["Banaras", "Kashi"], district: "Varanasi", state: "Uttar Pradesh" },
  { name: "Allahabad", aliases: ["Prayagraj"], district: "Prayagraj", state: "Uttar Pradesh" },
  { name: "Meerut", aliases: [], district: "Meerut", state: "Uttar Pradesh" },
  { name: "Ghaziabad", aliases: [], district: "Ghaziabad", state: "Uttar Pradesh" },
  { name: "Noida", aliases: ["Greater Noida"], district: "Gautam Buddh Nagar", state: "Uttar Pradesh" },

  // West Bengal
  { name: "Kolkata", aliases: ["Calcutta"], district: "Kolkata", state: "West Bengal" },
  { name: "Howrah", aliases: [], district: "Howrah", state: "West Bengal" },
  { name: "Asansol", aliases: [], district: "Paschim Bardhaman", state: "West Bengal" },
  { name: "Siliguri", aliases: [], district: "Darjeeling", state: "West Bengal" },
  { name: "Durgapur", aliases: [], district: "Paschim Bardhaman", state: "West Bengal" },

  // Delhi NCR
  { name: "New Delhi", aliases: ["Delhi", "NCT Delhi", "NCR"], district: "New Delhi", state: "Delhi" },
  { name: "Faridabad", aliases: [], district: "Faridabad", state: "Haryana" },
  { name: "Gurgaon", aliases: ["Gurugram"], district: "Gurgaon", state: "Haryana" },

  // Punjab
  { name: "Ludhiana", aliases: [], district: "Ludhiana", state: "Punjab" },
  { name: "Amritsar", aliases: [], district: "Amritsar", state: "Punjab" },
  { name: "Jalandhar", aliases: [], district: "Jalandhar", state: "Punjab" },
  { name: "Chandigarh", aliases: [], district: "Chandigarh", state: "Chandigarh" },

  // Bihar & Jharkhand
  { name: "Patna", aliases: [], district: "Patna", state: "Bihar" },
  { name: "Gaya", aliases: [], district: "Gaya", state: "Bihar" },
  { name: "Ranchi", aliases: [], district: "Ranchi", state: "Jharkhand" },
  { name: "Jamshedpur", aliases: [], district: "East Singhbhum", state: "Jharkhand" },
  { name: "Dhanbad", aliases: [], district: "Dhanbad", state: "Jharkhand" },

  // Odisha
  { name: "Bhubaneswar", aliases: [], district: "Khordha", state: "Odisha" },
  { name: "Cuttack", aliases: [], district: "Cuttack", state: "Odisha" },

  // Assam
  { name: "Guwahati", aliases: ["Gauhati"], district: "Kamrup Metropolitan", state: "Assam" },

  // Chhattisgarh
  { name: "Raipur", aliases: [], district: "Raipur", state: "Chhattisgarh" },
  { name: "Bhilai", aliases: ["Durg-Bhilai"], district: "Durg", state: "Chhattisgarh" },

  // Goa
  { name: "Panaji", aliases: ["Panjim"], district: "North Goa", state: "Goa" },

  // J&K
  { name: "Srinagar", aliases: [], district: "Srinagar", state: "Jammu and Kashmir" },
  { name: "Jammu", aliases: [], district: "Jammu", state: "Jammu and Kashmir" },
];

// ============================================================
// MUNICIPAL COUNCILS (Towns — Nagar Palika / Nagar Parishad)
// ============================================================
export const municipalCouncils = [
  // Maharashtra — extensive coverage
  { name: "Ichalkaranji", aliases: [], district: "Kolhapur", state: "Maharashtra" },

  { name: "Kagal", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Gadhinglaj", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Jaysingpur", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Kodoli", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Kurundwad", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Malkapur", aliases: [], district: "Kolhapur", state: "Maharashtra" },
  { name: "Satara", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Karad", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Wai", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Phaltan", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Baramati", aliases: [], district: "Pune", state: "Maharashtra" },
  { name: "Lonavala", aliases: ["Lonavla"], district: "Pune", state: "Maharashtra" },
  { name: "Talegaon Dabhade", aliases: ["Talegaon"], district: "Pune", state: "Maharashtra" },
  { name: "Shirur", aliases: [], district: "Pune", state: "Maharashtra" },
  { name: "Daund", aliases: [], district: "Pune", state: "Maharashtra" },
  { name: "Pandharpur", aliases: [], district: "Solapur", state: "Maharashtra" },
  { name: "Barshi", aliases: [], district: "Solapur", state: "Maharashtra" },
  { name: "Sangamner", aliases: [], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Shrirampur", aliases: [], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Kopargaon", aliases: [], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Shirdi", aliases: [], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Manmad", aliases: [], district: "Nashik", state: "Maharashtra" },
  { name: "Sinnar", aliases: [], district: "Nashik", state: "Maharashtra" },
  { name: "Igatpuri", aliases: [], district: "Nashik", state: "Maharashtra" },
  { name: "Trimbakeshwar", aliases: ["Trimbak"], district: "Nashik", state: "Maharashtra" },
  { name: "Ratnagiri", aliases: [], district: "Ratnagiri", state: "Maharashtra" },
  { name: "Chiplun", aliases: [], district: "Ratnagiri", state: "Maharashtra" },
  { name: "Sawantwadi", aliases: [], district: "Sindhudurg", state: "Maharashtra" },
  { name: "Vengurla", aliases: [], district: "Sindhudurg", state: "Maharashtra" },
  { name: "Ambernath", aliases: [], district: "Thane", state: "Maharashtra" },
  { name: "Badlapur", aliases: [], district: "Thane", state: "Maharashtra" },
  { name: "Karjat", aliases: [], district: "Raigad", state: "Maharashtra" },
  { name: "Pen", aliases: [], district: "Raigad", state: "Maharashtra" },
  { name: "Alibaug", aliases: ["Alibag"], district: "Raigad", state: "Maharashtra" },
  { name: "Wardha", aliases: [], district: "Wardha", state: "Maharashtra" },
  { name: "Hinganghat", aliases: [], district: "Wardha", state: "Maharashtra" },
  { name: "Yavatmal", aliases: [], district: "Yavatmal", state: "Maharashtra" },
  { name: "Gondia", aliases: [], district: "Gondia", state: "Maharashtra" },
  { name: "Bhandara", aliases: [], district: "Bhandara", state: "Maharashtra" },
  { name: "Buldhana", aliases: [], district: "Buldhana", state: "Maharashtra" },
  { name: "Washim", aliases: [], district: "Washim", state: "Maharashtra" },
  { name: "Osmanabad", aliases: ["Dharashiv"], district: "Osmanabad", state: "Maharashtra" },
  { name: "Beed", aliases: ["Bid"], district: "Beed", state: "Maharashtra" },
  { name: "Jalna", aliases: [], district: "Jalna", state: "Maharashtra" },
  { name: "Hingoli", aliases: [], district: "Hingoli", state: "Maharashtra" },

  // Karnataka
  { name: "Raichur", aliases: [], district: "Raichur", state: "Karnataka" },
  { name: "Bijapur", aliases: ["Vijayapura"], district: "Bijapur", state: "Karnataka" },
  { name: "Hassan", aliases: [], district: "Hassan", state: "Karnataka" },
  { name: "Mandya", aliases: [], district: "Mandya", state: "Karnataka" },
  { name: "Chitradurga", aliases: [], district: "Chitradurga", state: "Karnataka" },
  { name: "Hospet", aliases: ["Hosapete"], district: "Bellary", state: "Karnataka" },
  { name: "Udupi", aliases: [], district: "Udupi", state: "Karnataka" },
  { name: "Chikkamagaluru", aliases: ["Chikmagalur"], district: "Chikkamagaluru", state: "Karnataka" },
  { name: "Kolar", aliases: [], district: "Kolar", state: "Karnataka" },

  // Other states — representative towns
  { name: "Shirdi", aliases: [], district: "Ahmednagar", state: "Maharashtra" },
  { name: "Mathura", aliases: [], district: "Mathura", state: "Uttar Pradesh" },
  { name: "Vrindavan", aliases: [], district: "Mathura", state: "Uttar Pradesh" },
  { name: "Haridwar", aliases: ["Hardwar"], district: "Haridwar", state: "Uttarakhand" },
  { name: "Rishikesh", aliases: [], district: "Dehradun", state: "Uttarakhand" },
  { name: "Dehradun", aliases: [], district: "Dehradun", state: "Uttarakhand" },
  { name: "Nainital", aliases: [], district: "Nainital", state: "Uttarakhand" },
  { name: "Mussoorie", aliases: [], district: "Dehradun", state: "Uttarakhand" },
  { name: "Ooty", aliases: ["Udhagamandalam", "Ootacamund"], district: "Nilgiris", state: "Tamil Nadu" },
  { name: "Kodaikanal", aliases: [], district: "Dindigul", state: "Tamil Nadu" },
  { name: "Munnar", aliases: [], district: "Idukki", state: "Kerala" },
  { name: "Mount Abu", aliases: [], district: "Sirohi", state: "Rajasthan" },
  { name: "Pushkar", aliases: [], district: "Ajmer", state: "Rajasthan" },
  { name: "Mahabaleshwar", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Panchgani", aliases: [], district: "Satara", state: "Maharashtra" },
  { name: "Lavasa", aliases: [], district: "Pune", state: "Maharashtra" },
  { name: "Margao", aliases: ["Madgaon"], district: "South Goa", state: "Goa" },
  { name: "Mapusa", aliases: [], district: "North Goa", state: "Goa" },
  { name: "Vasco da Gama", aliases: ["Vasco"], district: "South Goa", state: "Goa" },
  { name: "Ponda", aliases: [], district: "South Goa", state: "Goa" },
];


// ============================================================
// KEYWORD-BASED CLASSIFICATION HINTS
// ============================================================
// Words that suggest rural/village origins
export const villageKeywords = [
  "wadi", "gaon", "gad", "khurd", "budruk", "tarf", "pada", "pura",
  "pur", "garh", "gram", "village", "hamlet", "nagar panchayat",
  "basthi", "tola", "basti", "majra", "dhani", "faliya"
];

// Words that suggest urban/city
export const urbanKeywords = [
  "nagar", "city", "metropolitan", "cantonment", "cantt",
  "industrial area", "smart city"
];

// ============================================================
// SUPPORTED LANGUAGES
// ============================================================
export const supportedLanguages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
];
