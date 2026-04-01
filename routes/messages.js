let express = require('express');
let router = express.Router();
let { CheckLogin } = require('../utils/authHandler');
let { uploadImage } = require('../utils/uploadHandler');
let messageModel = require('../schemas/messages');

/**
 * GET /
 * Lấy tin nhắn cuối cùng của mỗi cuộc hội thoại mà user hiện tại có liên quan
 * (user hiện tại nhắn cho ai, hoặc ai nhắn cho user hiện tại)
 */
router.get('/', CheckLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;

        // Dùng aggregation để lấy tin nhắn cuối cùng của mỗi người dùng khác
        let lastMessages = await messageModel.aggregate([
            {
                // Lấy tất cả tin nhắn liên quan đến user hiện tại
                $match: {
                    $or: [
                        { from: currentUserId },
                        { to: currentUserId }
                    ]
                }
            },
            {
                // Tạo field "partner" là người kia trong cuộc trò chuyện
                $addFields: {
                    partner: {
                        $cond: {
                            if: { $eq: ["$from", currentUserId] },
                            then: "$to",
                            else: "$from"
                        }
                    }
                }
            },
            {
                // Sắp xếp từ mới nhất đến cũ nhất
                $sort: { createdAt: -1 }
            },
            {
                // Nhóm theo partner, lấy tin nhắn đầu tiên (mới nhất) của mỗi nhóm
                $group: {
                    _id: "$partner",
                    lastMessage: { $first: "$$ROOT" }
                }
            },
            {
                // Thay thế root bằng lastMessage
                $replaceRoot: { newRoot: "$lastMessage" }
            },
            {
                // Sắp xếp lại theo thời gian tạo (mới nhất lên đầu)
                $sort: { createdAt: -1 }
            }
        ]);

        // Populate from và to sau khi aggregate
        let populated = await messageModel.populate(lastMessages, [
            { path: 'from', select: 'username email avatarUrl' },
            { path: 'to', select: 'username email avatarUrl' }
        ]);

        res.send(populated);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

/**
 * POST /
 * Gửi tin nhắn đến userID
 * Body (form-data): to (userID), text (nội dung nếu là text), file (nếu gửi file)
 */
router.post('/', CheckLogin, uploadImage.single('file'), async function (req, res, next) {
    try {
        let currentUserId = req.user._id;
        let { to, text } = req.body;

        if (!to) {
            return res.status(400).send({ message: "to (userID) is required" });
        }

        let messageContent;

        if (req.file) {
            // Có file đính kèm -> type = "file", text = đường dẫn file
            messageContent = {
                type: "file",
                text: req.file.path
            };
        } else {
            // Không có file -> type = "text", text = nội dung gửi
            if (!text) {
                return res.status(400).send({ message: "text is required when no file is attached" });
            }
            messageContent = {
                type: "text",
                text: text
            };
        }

        let newMessage = new messageModel({
            from: currentUserId,
            to: to,
            messageContent: messageContent
        });

        await newMessage.save();
        await newMessage.populate('from', 'username email avatarUrl');
        await newMessage.populate('to', 'username email avatarUrl');

        res.status(201).send(newMessage);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

/**
 * GET /:userID
 * Lấy toàn bộ tin nhắn giữa user hiện tại và userID
 * (from: currentUser, to: userID) HOẶC (from: userID, to: currentUser)
 */
router.get('/:userID', CheckLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;
        let targetUserId = req.params.userID;

        let messages = await messageModel.find({
            $or: [
                { from: currentUserId, to: targetUserId },
                { from: targetUserId, to: currentUserId }
            ]
        })
            .populate('from', 'username email avatarUrl')
            .populate('to', 'username email avatarUrl')
            .sort({ createdAt: 1 });

        res.send(messages);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

module.exports = router;
