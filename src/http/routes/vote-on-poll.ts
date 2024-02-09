import { FastifyInstance } from "fastify"
import { randomUUID } from 'node:crypto'
import { redis } from '../../lib/redis'
import { prisma } from "../../lib/prisma"
import { z } from 'zod'
import { voting } from "../../utils/voting-pub-sub"
export async function voteOnPoll(app : FastifyInstance){
    app.post("/polls/:pollId/votes", async (request, res)=>{
        const voteOnPollBody = z.object({
            pollOptionId : z.string().uuid()
        })

        const voteOnPollParams = z.object({
            pollId: z.string().uuid()
        })
        const { pollId } = voteOnPollParams.parse(request.params)
        const { pollOptionId } = voteOnPollBody.parse(request.body)
       
        let { sessionId } = request.cookies

        if(sessionId){
            const userPreviousVoteOnPoll = await prisma.vote.findUnique({
                where: {
                    sessionId_pollId:{
                        sessionId,
                        pollId
                    }
                }
            })

            if(userPreviousVoteOnPoll && userPreviousVoteOnPoll.pollOptionId !== pollOptionId){
                //apagar o voto atual
                // criar um novo
                await prisma.vote.delete({
                    where : {
                        id : userPreviousVoteOnPoll.id
                    }
                })

             
                const votes = await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId)

                voting.publish(pollId, {
                    pollOptionId : userPreviousVoteOnPoll.pollOptionId,
                    votes : Number(votes)
                })
            }
            else if(userPreviousVoteOnPoll) {
                return res.status(400).send({message : "Você já votou nessa enquete"})
            }
        }

        if(!sessionId){
         sessionId = randomUUID()
         res.setCookie('sessionId', sessionId, {
             path: '/',
             maxAge: 60*60*24*30, // 30 days
             signed: true,
             httpOnly: true
         })
        }
        await prisma.vote.create({
            data : {
                sessionId,
                pollId, 
                pollOptionId
            }
        })
       
        const votes = await redis.zincrby(pollId, 1, pollOptionId)

        voting.publish(pollId, {
            pollOptionId,
            votes : Number(votes)
        })

        return res.status(201).send({sessionId})
    })
    
    
}