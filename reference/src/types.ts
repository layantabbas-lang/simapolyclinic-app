export interface DocumentMetadata {
  document_type: string | null;
  date_of_report: string | null;
  facility_or_laboratory_name: string | null;
}

export interface QuantitativeResult {
  parameter_name: string;
  value: string | number;
  unit: string | null;
  reference_range: string | null;
  is_abnormal: boolean;
}

export interface QualitativeFinding {
  anatomical_site: string;
  finding_description: string;
  is_critical: boolean;
}

export interface ExtractedData {
  quantitative_results: QuantitativeResult[];
  qualitative_findings: QualitativeFinding[];
}

export interface AnalysisJSONResponse {
  document_metadata: DocumentMetadata;
  extracted_data: ExtractedData;
  clinical_summary: string;
}

export interface ClinicalPreset {
  id: string;
  name: string;
  type: string;
  description: string;
  rawText: string;
  imageMockUrl?: string;
  mockResponse: AnalysisJSONResponse;
}
