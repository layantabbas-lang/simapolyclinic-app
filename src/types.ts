export interface Patient {
  mrn: number;
  firstName: string;
  surname: string;
  birthDate: string; // ISO yyyy-mm-dd
  gender: "Male" | "Female";
  phone: string;
  email: string;
  insuranceProvider: string;
}

export interface UserSession {
  id?: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "doctor" | "secretary";
}
