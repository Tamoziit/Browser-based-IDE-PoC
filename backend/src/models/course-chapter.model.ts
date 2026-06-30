import mongoose from "mongoose";

const CourseChapterSchema = new mongoose.Schema({
	title: {
		type: String,
		required: true
	},
	description: {
		type: String
	},
	learningPointer: {
		type: Array,
		default: []
	},
	isLab: {
		type: Boolean,
		required: true
	},
	labType: {
		type: String,
		enum: ["RO_EXEC", "RWX"],
	},
	duration: { type: String, required: true },
}, { timestamps: true });

const CourseChapter = mongoose.model("CourseChapter", CourseChapterSchema);
export default CourseChapter;