import { Document, Model, model, Schema, HookNextFunction } from "mongoose";
import { CollectionsNames } from "../../utils/consts";

export interface IUser extends InputUserData, Document {}
export interface InputUserData {
    email: string;
    username: string;
    password: string;
    name: string;
    profileImage: string;
    date?: number;
}

const UserSchema: Schema = new Schema<IUser>({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    profileImage: { type: String, default: process.env.DEFUALT_PROFILE_IMAGE_URL },
    date: { type: Number, default: Date.now }
}, { collection: CollectionsNames.Users });

/* pre functions */
UserSchema.pre<IUser>('save', async (next: HookNextFunction) => {
    try {
        // Use any model controller for doing some stuff before save this document
        next()
    } catch(ex) {
        return next(ex);
    }
});

export const UserModel: Model<IUser> = model<IUser>(CollectionsNames.Users, UserSchema);

// Firebase way
// export interface User {
//     email: string;
//     username: string;
//     password: string;
//     name: string;
//     profileImage: string;
//     date: number;
// }