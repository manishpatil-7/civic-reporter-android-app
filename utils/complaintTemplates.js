/**
 * Deterministic Complaint Letter Templates (Backend)
 * Shared with React Native Mobile Client & Web Application
 * Implements Section 8 of YOLO-First + Gemini Rebuild Specification
 */

export const TEMPLATE_TYPES = {
  ROAD_DAMAGE: "pothole",
  GARBAGE: "garbage",
  STREETLIGHT: "streetlight",
  DRAINAGE: "drainage",
  GENERAL: "general",
};

export const getTemplateType = (problemType = "", category = "") => {
  const text = `${problemType} ${category}`.toLowerCase();
  if (
    text.includes("pothole") ||
    text.includes("road") ||
    text.includes("asphalt") ||
    text.includes("crater") ||
    text.includes("pavement")
  ) {
    return TEMPLATE_TYPES.ROAD_DAMAGE;
  }
  if (
    text.includes("garbage") ||
    text.includes("waste") ||
    text.includes("trash") ||
    text.includes("sanitation") ||
    text.includes("dump") ||
    text.includes("litter")
  ) {
    return TEMPLATE_TYPES.GARBAGE;
  }
  if (
    text.includes("light") ||
    text.includes("streetlight") ||
    text.includes("pole") ||
    text.includes("lamp") ||
    text.includes("luminaire")
  ) {
    return TEMPLATE_TYPES.STREETLIGHT;
  }
  if (
    text.includes("drain") ||
    text.includes("flood") ||
    text.includes("sewer") ||
    text.includes("waterlog") ||
    text.includes("gutter")
  ) {
    return TEMPLATE_TYPES.DRAINAGE;
  }
  return TEMPLATE_TYPES.GENERAL;
};

export const generateDeterministicLetter = ({
  templateType = TEMPLATE_TYPES.GENERAL,
  userName = "Concerned Citizen",
  locationAddress = "",
  authorityInfo = null,
  problemType = "Civic Infrastructure Defect",
  detectionCount = 1,
  severity = "Medium",
  detectedDefects = [], // For streetlight physical defects
}) => {
  const today = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const loc = locationAddress || "the specified civic jurisdiction";
  const cleanLoc = loc.split(",")[0].trim();

  // Authority Header Block
  let header = authorityInfo?.letterHeader;
  if (!header) {
    const authTitle = authorityInfo?.authorityTitle || "The Municipal Commissioner";
    const authBody = authorityInfo?.authorityBody || "Municipal Corporation";
    const dept = authorityInfo?.department || "Concerned Department";
    header = `To,\n${authTitle},\n${dept},\n${authBody}`;
  }

  const subject = `Subject: Urgent complaint regarding ${problemType} at ${cleanLoc}`;
  const salutation = "Respected Sir/Madam,";

  let body = "";

  switch (templateType) {
    case TEMPLATE_TYPES.ROAD_DAMAGE:
      body =
        `I am writing to bring to your urgent attention severe road surface deterioration and ${
          detectionCount > 1 ? `${detectionCount} prominent potholes` : "a severe pothole"
        } located at ${loc}.\n\n` +
        `This structural road damage poses an acute vehicular collision hazard and significant personal safety risk, particularly to two-wheeler riders, emergency response vehicles, and pedestrians traveling along this transit route. With ongoing vehicular traffic, these asphalt fractures continue to widen rapidly.\n\n` +
        `I kindly request the Municipal Works and Engineering Department to schedule an immediate on-site technical inspection, dispatch repair road crews with quality asphalt bitumen patch mix, and erect temporary reflective warning barricades around the depression to prevent accidents until resurfacing is complete.`;
      break;

    case TEMPLATE_TYPES.GARBAGE:
      body =
        `I am writing to submit an urgent sanitation complaint regarding uncollected solid waste accumulation and illegal dumping located at ${loc}.\n\n` +
        `The accumulating waste heap has begun generating noxious odors and has created an active breeding ground for disease vectors including stray animals, flies, and mosquitoes. In addition to obstructing the public thoroughfare, it poses immediate public hygiene risks to residents, local vendors, and schoolchildren passing nearby.\n\n` +
        `I request the Solid Waste Management and Public Health Department to urgently dispatch a mechanized collection vehicle to clear and sanitize the affected stretch, and to install standard municipal waste receptacles alongside preventative signage to discourage recurring unauthorized dumping.`;
      break;

    case TEMPLATE_TYPES.STREETLIGHT: {
      const defectsText =
        detectedDefects && detectedDefects.length > 0
          ? `Physical inspection indicates specific defects: ${detectedDefects.join(", ")}.`
          : `Physical inspection of the public lighting installation reveals evident physical or structural damage to the luminaire fixture assembly.`;

      body =
        `I am writing to formally report damaged public lighting infrastructure located at ${loc}.\n\n` +
        `${defectsText} The resulting lack of illumination creates pedestrian safety hazards, elevates vehicular collision risks after twilight, and increases vulnerability along this public corridor.\n\n` +
        `I respectfully urge the Public Lighting and Electrical Engineering Wing to dispatch an authorized technical maintenance team to inspect the physical pole structure, repair or replace the damaged lamp head and fixtures, and restore secure street lighting promptly.`;
      break;
    }

    case TEMPLATE_TYPES.DRAINAGE:
      body =
        `I am writing to register an urgent grievance regarding blocked drainage channels, stormwater overflow, and waterlogging at ${loc}.\n\n` +
        `The accumulated silt, debris, and stormwater runoff have severely impeded standard gravitational drainage flow. The stagnant water and sewage backflow present serious waterborne contamination hazards, degrade surrounding road pavement foundations, and hinder local vehicular transit.\n\n` +
        `I kindly request the Sewerage and Drainage Department to deploy suction tankers or desilting personnel to unclog the drain culverts immediately and implement preventive mesh barriers to ensure uninterrupted drainage discharge.`;
      break;

    case TEMPLATE_TYPES.GENERAL:
    default:
      body =
        `I wish to draw your immediate attention to a verified civic infrastructure defect involving ${problemType} located at ${loc}.\n\n` +
        `The present condition of this municipal utility creates recurring daily inconvenience to local citizens and risks progressive structural deterioration if left unaddressed. Photographic evidence and geocoded coordinates have been recorded for your department's reference.\n\n` +
        `I request the competent municipal authority to carry out an expeditious site verification and initiate appropriate remedial action to restore this public facility to standard working condition.`;
      break;
  }

  const signoff = `Thank you for your prompt consideration and public service.\n\nYours faithfully,\n${
    userName || "Resident / Concerned Citizen"
  }\nCivic Reporter Citizen Verification`;

  return `Date: ${today}\n\n${header}\n\n${subject}\n\n${salutation}\n\n${body}\n\n${signoff}`;
};

export default {
  TEMPLATE_TYPES,
  getTemplateType,
  generateDeterministicLetter,
};
