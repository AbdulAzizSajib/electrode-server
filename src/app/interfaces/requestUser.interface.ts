import { RoleName } from "../constants/role.constant";

export interface IRequestUser {
    userId: string;
    role: RoleName;
    email: string;
}
